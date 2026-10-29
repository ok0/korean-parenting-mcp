import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { VERSION } from "../../src/version.js";

export type SmokeId = "healthz" | "privacy" | "tools-list" | "get-timeline" | "origin" | "query";

export const SMOKE_IDS: readonly SmokeId[] = ["healthz", "privacy", "tools-list", "get-timeline", "origin", "query"];

export interface SmokeCheck {
  id: SmokeId | "user";
  ok: boolean;
  detail: string;
}

export interface SmokeOptions {
  expectOrigin: "reject" | "allow";
  timeoutMs?: number;
}

export const SMOKE_PLACEHOLDER_ENV: Readonly<Record<string, string>> = {
  KPM_OPERATOR_CONTACT: "smoke-operator@example.com",
  KPM_HOST_PROVIDER: "smoke-host",
  KPM_HOST_COUNTRY: "KR",
  KPM_HOST_REGION: "smoke-region",
  KPM_HOST_LOG_RETENTION: "smoke-7d",
  KPM_HOST_REQUEST_LOGS: "excluded",
};

export const BAD_ORIGIN = "https://smoke-disallowed.example";

export const SMOKE_TIMELINE_ARGS = { reference_date: "2026-10-28", birth_date: "2026-05-28" } as const;

const CLIENT_INFO = { name: "kpm-remote-smoke", version: VERSION } as const;
const DEFAULT_TIMEOUT_MS = 30000;

interface Outcome {
  ok: boolean;
  detail: string;
}

function errorName(err: unknown): string {
  if (typeof err === "object" && err !== null && "name" in err && typeof err.name === "string") return err.name;
  return "Error";
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(Object.assign(new Error("timeout"), { name: "TimeoutError" }));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function drain(res: Response): void {
  void res.body?.cancel().catch(() => undefined);
}

function httpOutcome(status: number, expected: number): Outcome {
  return { ok: status === expected, detail: `status ${status}` };
}

async function toolsListCheck(client: Client, timeoutMs: number): Promise<SmokeCheck> {
  try {
    const { tools } = await withTimeout(client.listTools(), timeoutMs);
    const names = tools.map((t) => t.name);
    const ok = names.includes("get_timeline") && !names.includes("check_recall") && !names.includes("get_leave_article");
    return { id: "tools-list", ok, detail: ok ? `tools ${names.length}` : "unexpected tool set" };
  } catch (err) {
    return { id: "tools-list", ok: false, detail: errorName(err) };
  }
}

async function getTimelineCheck(client: Client, timeoutMs: number): Promise<SmokeCheck> {
  try {
    const result = await withTimeout(
      client.callTool({ name: "get_timeline", arguments: { ...SMOKE_TIMELINE_ARGS } }),
      timeoutMs,
    );
    const first = Array.isArray(result.content) ? result.content[0] : undefined;
    const ok =
      result.isError !== true &&
      first !== undefined &&
      first.type === "text" &&
      typeof first.text === "string" &&
      first.text.trim() !== "";
    return { id: "get-timeline", ok, detail: ok ? "status 200" : "empty or error result" };
  } catch (err) {
    return { id: "get-timeline", ok: false, detail: errorName(err) };
  }
}

async function mcpChecks(base: string, timeoutMs: number): Promise<[SmokeCheck, SmokeCheck]> {
  const client = new Client(CLIENT_INFO);
  try {
    try {
      await withTimeout(client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`))), timeoutMs);
    } catch (err) {
      const detail = errorName(err);
      return [
        { id: "tools-list", ok: false, detail },
        { id: "get-timeline", ok: false, detail },
      ];
    }
    return [await toolsListCheck(client, timeoutMs), await getTimelineCheck(client, timeoutMs)];
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function runRemoteSmoke(baseUrl: string, opts: SmokeOptions): Promise<SmokeCheck[]> {
  const base = baseUrl.replace(/\/$/, "");
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const request = (path: string, init?: RequestInit): Promise<Response> =>
    fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });

  const guard = async (id: SmokeId, run: () => Promise<Outcome>): Promise<SmokeCheck> => {
    try {
      return { id, ...(await run()) };
    } catch (err) {
      return { id, ok: false, detail: errorName(err) };
    }
  };

  const checks: SmokeCheck[] = [];
  checks.push(
    await guard("healthz", async () => {
      const res = await request("/healthz");
      const body = await res.text();
      const outcome = httpOutcome(res.status, 200);
      return { ok: outcome.ok && body.trim() === "ok", detail: outcome.detail };
    }),
  );
  checks.push(
    await guard("privacy", async () => {
      const res = await request("/privacy");
      drain(res);
      const outcome = httpOutcome(res.status, 200);
      const html = (res.headers.get("content-type") ?? "").startsWith("text/html");
      return { ok: outcome.ok && html, detail: outcome.detail };
    }),
  );

  const [toolsList, getTimeline] = await mcpChecks(base, timeoutMs);
  checks.push(toolsList, getTimeline);

  checks.push(
    await guard("origin", async () => {
      const body = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO },
      });
      const res = await request("/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": LATEST_PROTOCOL_VERSION,
          origin: BAD_ORIGIN,
        },
        body,
      });
      drain(res);
      return httpOutcome(res.status, opts.expectOrigin === "reject" ? 403 : 200);
    }),
  );
  checks.push(
    await guard("query", async () => {
      const res = await request("/healthz?smoke=1");
      drain(res);
      return httpOutcome(res.status, 400);
    }),
  );

  return SMOKE_IDS.map((id) => checks.find((c) => c.id === id) ?? { id, ok: false, detail: "missing" });
}

export interface LocalRemote {
  baseUrl: string;
  stop(): Promise<void>;
}

const LOCAL_START_FAILED = "로컬 원격 서버 시작 실패";
const LISTEN_PATTERN = /listening on 127\.0\.0\.1:(\d+)/;

function waitForListen(child: ChildProcess, timeoutMs: number): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    let buffer = "";
    let settled = false;
    const fail = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      reject(new Error(LOCAL_START_FAILED));
    };
    const timer = setTimeout(fail, timeoutMs);
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      if (settled) return;
      buffer += chunk;
      const match = LISTEN_PATTERN.exec(buffer);
      if (match?.[1] !== undefined) {
        settled = true;
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
    child.once("exit", fail);
    child.once("error", fail);
  });
}

export async function startLocalRemote(opts: {
  root: string;
  extraEnv?: Readonly<Record<string, string>>;
  timeoutMs?: number;
}): Promise<LocalRemote> {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    ...SMOKE_PLACEHOLDER_ENV,
    KPM_HTTP_HOST: "127.0.0.1",
    KPM_HTTP_PORT: "0",
    ...opts.extraEnv,
  };
  const child = spawn(process.execPath, [join(opts.root, "build/remote/main.js")], {
    cwd: opts.root,
    env,
    stdio: ["ignore", "ignore", "pipe"],
  });
  const port = await waitForListen(child, opts.timeoutMs ?? 10000);
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    stop: () =>
      new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) {
          resolve();
          return;
        }
        const killTimer = setTimeout(() => {
          child.kill("SIGKILL");
        }, 5000);
        child.once("exit", () => {
          clearTimeout(killTimer);
          resolve();
        });
        child.kill("SIGTERM");
      }),
  };
}

export function formatReport(checks: readonly SmokeCheck[]): { lines: string[]; ok: boolean } {
  const lines = checks.map((c) => (c.ok ? `PASS ${c.id}` : `FAIL ${c.id} (${c.detail})`));
  return { lines, ok: checks.every((c) => c.ok) };
}
