import { request, createServer as createHttpServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { ToolContext } from "../../src/core/context.js";
import { createLogger } from "../../src/core/logger.js";
import { buildRemoteDeps, createRemoteHandler, type RemoteDeps, type RemoteDepsExtras, type RemoteHandler } from "../../src/remote/app.js";
import { createMetricsLog } from "../../src/remote/metrics-log.js";
import { loadRemoteConfig, type RemoteConfig } from "../../src/remote/remote-config.js";
import { REMOTE_TEST_ENV } from "./remote-env.js";

export interface StartedRemote {
  port: number;
  url: URL;
  handler: RemoteHandler;
  deps: RemoteDeps;
  close(): Promise<void>;
}

export async function startRemote(
  rcOver: Partial<RemoteConfig> = {},
  ctxOver: Partial<ToolContext> = {},
  env: Record<string, string> = {},
  extras: RemoteDepsExtras = {},
): Promise<StartedRemote> {
  const rc: RemoteConfig = {
    ...loadRemoteConfig({ ...REMOTE_TEST_ENV, ...env }),
    rate: { perClientPerMin: 1_000_000, sharedPoolPerMin: 1_000_000, globalPerMin: 1_000_000, maxConcurrent: 1_000 },
    ...rcOver,
  };
  const overrides: Partial<ToolContext> = { ...ctxOver };
  if (!overrides.log) overrides.log = createLogger(rc.secrets, "warn", () => {});
  const deps = buildRemoteDeps(rc, overrides, { metrics: createMetricsLog(() => {}), ...extras });
  const handler = createRemoteHandler(deps);
  const server: Server = createHttpServer((req, res) => {
    void handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  const url = new URL(`http://127.0.0.1:${port}/mcp`);
  return {
    port,
    url,
    handler,
    deps,
    close: async () => {
      handler.closeStreams();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export interface RawRequest {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: string;
  untilHeaders?: boolean;
}

export interface RawResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
  destroy(): void;
}

export function rawRequest(port: number, opts: RawRequest): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        method: opts.method,
        path: opts.path,
        headers: { host: `127.0.0.1:${port}`, ...(opts.headers ?? {}) },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (opts.untilHeaders) {
          resolve({
            status,
            headers: res.headers,
            body: "",
            destroy: () => {
              req.destroy();
              res.destroy();
            },
          });
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("error", reject);
        res.on("end", () => {
          resolve({
            status,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
            destroy: () => {},
          });
        });
      },
    );
    req.on("error", reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

export const mcpHeaders: Record<string, string> = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};

export function initBody(version = "2025-11-25"): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: version, capabilities: {}, clientInfo: { name: "t", version: "0" } },
  });
}
