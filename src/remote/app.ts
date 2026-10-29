import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createDefaultContext, type ToolContext } from "../core/context.js";
import { createLogger } from "../core/logger.js";
import type { ToolResult } from "../core/errors.js";
import { createServer } from "../server/create-server.js";
import { allTools, type ToolDef } from "../tools/registry.js";
import { buildRemoteInstructions, excludedFallback, remoteTools } from "./allowlist.js";
import type { RemoteConfig } from "./remote-config.js";
import { checkRequest } from "./request-guard.js";

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

export interface RemoteDeps {
  rc: RemoteConfig;
  baseCtx: ToolContext;
  tools: readonly ToolDef[];
  instructions: string;
  fallback: (name: string) => ToolResult | undefined;
}

export interface RemoteHandler {
  (req: IncomingMessage, res: ServerResponse): Promise<void>;
  closeStreams(): void;
  readonly openStreams: number;
}

const BODIES: Record<number, string> = {
  400: "bad request",
  401: "unauthorized",
  403: "forbidden",
  404: "not found",
  405: "method not allowed",
  415: "unsupported media type",
  500: "internal error",
  503: "service unavailable",
};

export function buildRemoteDeps(rc: RemoteConfig, overrides: Partial<ToolContext> = {}): RemoteDeps {
  const baseCtx = createDefaultContext(rc.base, {
    secrets: rc.secrets,
    log: createLogger(rc.secrets, rc.base.logLevel),
    ...overrides,
  });
  return {
    rc,
    baseCtx,
    tools: remoteTools(allTools),
    instructions: buildRemoteInstructions(),
    fallback: (n) => excludedFallback(n),
  };
}

function enforceSecurityHeaders(res: ServerResponse): void {
  const setAll = (): void => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  };
  setAll();
  const original = res.writeHead.bind(res);
  res.writeHead = ((...args: unknown[]) => {
    for (const a of args) {
      if (typeof a === "object" && a !== null && !Array.isArray(a)) {
        const headers = a as Record<string, unknown>;
        for (const k of Object.keys(headers)) {
          if (k.toLowerCase() in SECURITY_HEADERS) delete headers[k];
        }
      }
    }
    setAll();
    return (original as (...xs: unknown[]) => ServerResponse)(...args);
  }) as unknown as typeof res.writeHead;
}

function reject(res: ServerResponse, status: number, extra: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8", ...extra });
  res.end(BODIES[status]);
}

export function createRemoteHandler(deps: RemoteDeps): RemoteHandler {
  const streams = new Set<() => void>();
  let openStreams = 0;

  const open = async () => {
    const server = createServer({ ...deps.baseCtx }, deps.tools, {
      instructions: deps.instructions,
      fallback: deps.fallback,
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    return { server, transport };
  };

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    enforceSecurityHeaders(res);
    try {
      const g = checkRequest(req, deps.rc);
      if (!g.ok) {
        req.resume();
        const extra: Record<string, string> = {};
        if (g.allow !== undefined) extra.allow = g.allow;
        if (g.status === 401) extra["www-authenticate"] = "Bearer";
        reject(res, g.status, extra);
        return;
      }

      if (g.route === "healthz") {
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        if ((req.method ?? "").toUpperCase() === "HEAD") res.end();
        else res.end("ok");
        return;
      }

      if (g.route !== "mcp") {
        reject(res, 404);
        return;
      }

      const method = (req.method ?? "GET").toUpperCase();
      if (method === "POST") {
        const { server, transport } = await open();
        res.on("close", () => {
          void transport.close();
          void server.close();
        });
        await transport.handleRequest(req, res);
        return;
      }

      if (openStreams >= deps.rc.sseMaxStreams) {
        req.resume();
        reject(res, 503, { "retry-after": "30" });
        return;
      }

      openStreams++;
      let opened: Awaited<ReturnType<typeof open>>;
      try {
        opened = await open();
      } catch (err) {
        openStreams--;
        throw err;
      }
      const { server, transport } = opened;
      let done = false;
      let timer: NodeJS.Timeout | undefined;
      const finish = (): void => {
        if (done) return;
        done = true;
        openStreams--;
        clearTimeout(timer);
        streams.delete(finish);
        void transport.close().finally(() => {
          if (!res.writableEnded) res.end();
        });
        void server.close();
      };
      streams.add(finish);
      timer = setTimeout(finish, deps.rc.sseMaxMs);
      res.on("close", finish);
      await transport.handleRequest(req, res);
    } catch {
      if (!res.headersSent) reject(res, 500);
      else res.destroy();
    }
  };

  const closeStreams = (): void => {
    for (const finish of [...streams]) finish();
  };

  const result = handler as unknown as RemoteHandler;
  Object.defineProperty(result, "closeStreams", { value: closeStreams, enumerable: true });
  Object.defineProperty(result, "openStreams", { get: () => openStreams, enumerable: true });
  return result;
}
