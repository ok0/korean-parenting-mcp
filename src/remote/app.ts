import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SUPPORTED_PROTOCOL_VERSIONS } from "@modelcontextprotocol/sdk/types.js";
import { TtlCache } from "../core/cache.js";
import { createDefaultContext, type Clock, type ToolContext } from "../core/context.js";
import type { ErrorKind, ToolResult } from "../core/errors.js";
import { createUpstreamGuard, type UpstreamGuard } from "../core/upstream-guard.js";
import { createServer } from "../server/create-server.js";
import { allTools, type ToolDef } from "../tools/registry.js";
import { buildRemoteInstructions, excludedFallback, remoteTools } from "./allowlist.js";
import {
  createMetricsLog,
  createRemoteLogger,
  type MetricsEvent,
  type MetricsLog,
  type Outcome,
  type Rpc,
} from "./metrics-log.js";
import { PAGE_CSP, renderLandingPage, renderPrivacyPage } from "./privacy.js";
import { createWebhookNotifier, WEBHOOK_TIMEOUT_MS } from "./quota-alert.js";
import { createClientKeyResolver, createRateLimiter, type RateLimiter } from "./rate-limit.js";
import { REMOTE_CACHE_MAX_ENTRIES, type RemoteConfig } from "./remote-config.js";
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
  metrics: MetricsLog;
  limiter: RateLimiter;
  clock: Clock;
  clientKey: (req: IncomingMessage) => string;
}

export type RemoteDepsExtras = Partial<Pick<RemoteDeps, "metrics" | "limiter" | "clock">> & {
  webhookFetch?: typeof fetch;
  webhookTimeoutMs?: number;
};

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
  413: "payload too large",
  415: "unsupported media type",
  500: "internal error",
  503: "service unavailable",
};

export function buildRemoteDeps(
  rc: RemoteConfig,
  overrides: Partial<ToolContext> = {},
  extras: RemoteDepsExtras = {},
): RemoteDeps {
  const metrics = extras.metrics ?? createMetricsLog();
  const notify = rc.quota.alertWebhookUrl
    ? createWebhookNotifier(
        rc.quota.alertWebhookUrl,
        extras.webhookFetch ?? globalThis.fetch.bind(globalThis),
        extras.webhookTimeoutMs ?? WEBHOOK_TIMEOUT_MS,
      )
    : undefined;
  const pending = new Set<Promise<void>>();
  const drain = async (): Promise<void> => {
    if (pending.size > 0) await Promise.allSettled([...pending]);
  };
  const guard = createUpstreamGuard({
    ...rc.quota,
    onEvent: (e) => {
      metrics.emit({ ev: "quota", ...e });
      if (notify) {
        const p = notify(e);
        pending.add(p);
        void p.then(() => pending.delete(p));
      }
    },
  });
  const upstream: UpstreamGuard = {
    async admit(url, nowMs) {
      try {
        await guard.admit(url, nowMs);
      } finally {
        await drain();
      }
    },
    minTtl: (k) => guard.minTtl(k),
    staleMaxMs: guard.staleMaxMs,
    async markExhausted(b, nowMs) {
      await guard.markExhausted(b, nowMs);
      await drain();
    },
    counts: (n) => guard.counts(n),
  };
  const baseCtx = createDefaultContext(rc.base, {
    secrets: rc.secrets,
    log: createRemoteLogger(rc.secrets),
    cache: new TtlCache(REMOTE_CACHE_MAX_ENTRIES, rc.quota.staleMaxMs),
    upstream,
    ...(rc.lawRemote ? {} : { revisionCheck: "remote-unavailable" as const }),
    ...overrides,
  });
  return {
    rc,
    baseCtx,
    tools: remoteTools(allTools),
    instructions: buildRemoteInstructions(),
    fallback: (n) => excludedFallback(n),
    metrics,
    limiter: extras.limiter ?? createRateLimiter({ ...rc.rate, sharedEgressCidrs: rc.sharedEgressCidrs, dailyCap: rc.dailyRequestCap }),
    clock: extras.clock ?? baseCtx.clock,
    clientKey: createClientKeyResolver({
      trustProxy: rc.trustProxy,
      trustedProxyCidrs: rc.trustedProxyCidrs,
      xffClientIndexFromRight: rc.xffClientIndexFromRight,
    }),
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

function rejectJson(
  res: ServerResponse,
  status: number,
  code: number,
  message: string,
  extra: Record<string, string> = {},
): void {
  res.writeHead(status, { "content-type": "application/json", ...extra });
  res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code, message } }));
}

function originCategory(h: string | string[] | undefined): "none" | "claude" | "other" {
  if (h === undefined) return "none";
  const first = (Array.isArray(h) ? (h[0] ?? "") : h).toLowerCase().replace(/\/+$/, "");
  return ["https://claude.ai", "https://claude.com"].includes(first) ? "claude" : "other";
}

type BodyResult = { ok: true; text: string } | { ok: false };

function readBody(req: IncomingMessage, max: number): Promise<BodyResult> {
  const cl = req.headers["content-length"];
  if (typeof cl === "string" && /^\d+$/.test(cl) && Number(cl) > max) {
    req.resume();
    return Promise.resolve({ ok: false });
  }
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (r: BodyResult): void => {
      if (settled) return;
      settled = true;
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onFail);
      req.off("close", onFail);
      resolve(r);
    };
    const onData = (c: Buffer): void => {
      size += c.length;
      if (size > max) {
        chunks.length = 0;
        req.off("data", onData);
        req.resume();
        finish({ ok: false });
        return;
      }
      chunks.push(c);
    };
    const onEnd = (): void => finish({ ok: true, text: Buffer.concat(chunks).toString("utf8") });
    const onFail = (): void => finish({ ok: false });
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onFail);
    req.on("close", onFail);
  });
}

type ReqEvent = Extract<MetricsEvent, { ev: "req" }>;

interface ReqState {
  rpc: Rpc;
  tool?: string;
  outcome?: Outcome;
  reason?: ReqEvent["reason"];
  kind?: ErrorKind;
  origin: ReqEvent["origin"];
  proto?: string;
  metaProto?: string;
  pool?: "direct" | "shared";
  done?: { ok: boolean; kind?: ErrorKind };
}

const KNOWN_RPCS: readonly string[] = ["initialize", "server/discover", "tools/list", "tools/call"];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function describeRpc(body: unknown, m: ReqState): void {
  if (!isRecord(body) || typeof body.method !== "string") {
    m.rpc = "other";
    return;
  }
  const method = body.method;
  m.rpc = KNOWN_RPCS.includes(method) ? (method as Rpc) : "other";
  const params = isRecord(body.params) ? body.params : undefined;
  if (m.rpc === "tools/call" && params && typeof params.name === "string") m.tool = params.name;
  const meta = params && isRecord(params._meta) ? params._meta : undefined;
  if (meta && typeof meta.protocolVersion === "string") m.metaProto = meta.protocolVersion;
}

function finalEvent(m: ReqState, http: number, ms: number, fallback: RemoteDeps["fallback"]): MetricsEvent {
  let outcome: Outcome;
  let kind: ErrorKind | undefined = m.kind;
  if (m.outcome !== undefined) {
    outcome = m.outcome;
  } else if (http >= 400) {
    outcome = "rejected";
  } else if (m.rpc === "tools/call") {
    if (m.done) {
      outcome = m.done.ok ? "ok" : "tool_error";
      kind = m.done.kind;
    } else if (m.tool !== undefined && fallback(m.tool) !== undefined) {
      outcome = "ok";
    } else {
      outcome = "tool_error";
      kind = "BAD_INPUT";
    }
  } else {
    outcome = "ok";
  }
  return {
    ev: "req",
    rpc: m.rpc,
    tool: m.rpc === "tools/call" ? (m.tool ?? "unknown") : undefined,
    http,
    outcome,
    reason: m.reason,
    kind,
    ms,
    origin: m.origin,
    proto: m.proto,
    metaProto: m.metaProto,
    pool: m.pool,
  };
}

export function createRemoteHandler(deps: RemoteDeps): RemoteHandler {
  const streams = new Set<() => void>();
  let openStreams = 0;

  const open = async (ctx: ToolContext) => {
    const server = createServer(ctx, deps.tools, {
      instructions: deps.instructions,
      fallback: deps.fallback,
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    return { server, transport };
  };

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    enforceSecurityHeaders(res);
    const t0 = Date.now();
    const m: ReqState = { rpc: "other", origin: originCategory(req.headers.origin) };
    let record = true;
    res.once("close", () => {
      if (record) deps.metrics.emit(finalEvent(m, res.statusCode, Date.now() - t0, deps.fallback));
    });
    try {
      const g = checkRequest(req, deps.rc);
      if (!g.ok) {
        m.outcome = "rejected";
        m.reason = g.reason;
        req.resume();
        const extra: Record<string, string> = {};
        if (g.allow !== undefined) extra.allow = g.allow;
        if (g.status === 401) extra["www-authenticate"] = "Bearer";
        reject(res, g.status, extra);
        return;
      }

      if (g.originReport) m.reason = "origin";
      const pv = req.headers["mcp-protocol-version"];
      if (typeof pv === "string" && SUPPORTED_PROTOCOL_VERSIONS.includes(pv)) m.proto = pv;

      if (g.route === "healthz") {
        record = false;
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        if ((req.method ?? "").toUpperCase() === "HEAD") res.end();
        else res.end("ok");
        return;
      }

      if (g.route === "privacy" || g.route === "landing") {
        record = false;
        const host = deps.rc.allowedHosts[0] ?? "localhost";
        const html = g.route === "privacy"
          ? renderPrivacyPage({ contact: deps.rc.operatorContact, host, hosting: deps.rc.hosting })
          : renderLandingPage({ host });
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": PAGE_CSP });
        if ((req.method ?? "").toUpperCase() === "HEAD") res.end();
        else res.end(html);
        return;
      }

      if (g.route !== "mcp") {
        m.outcome = "rejected";
        m.reason = "path";
        reject(res, 404);
        return;
      }

      const method = (req.method ?? "GET").toUpperCase();
      if (method === "POST") {
        const t = await deps.limiter.take(deps.clientKey(req), deps.clock.now().getTime());
        m.pool = t.pool;
        if (!t.ok) {
          m.outcome = "rate_limited";
          req.resume();
          const msg = t.scope === "daily"
            ? "오늘 원격 사용량 한도에 도달했습니다. 한국 시간 자정 이후 다시 시도하세요."
            : `요청이 많습니다. ${t.retryAfterSec}초 후 다시 시도하세요.`;
          rejectJson(res, 429, -32029, msg, {
            "retry-after": String(t.retryAfterSec),
          });
          return;
        }
        res.once("close", t.release);

        const body = await readBody(req, deps.rc.maxBodyBytes);
        if (!body.ok) {
          m.outcome = "rejected";
          m.reason = "body";
          if (!res.writableEnded && !res.destroyed) {
            reject(res, 413, { connection: "close" });
            res.once("finish", () => {
              setTimeout(() => req.socket?.destroy(), 1000).unref();
            });
          }
          return;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(body.text);
        } catch {
          m.outcome = "rejected";
          m.reason = "parse";
          rejectJson(res, 400, -32700, "parse error");
          return;
        }

        describeRpc(parsed, m);
        const ctx: ToolContext = {
          ...deps.baseCtx,
          notices: [],
          onToolDone: (e) => {
            m.done = { ok: e.ok, ...(e.kind ? { kind: e.kind } : {}) };
          },
        };
        const { server, transport } = await open(ctx);
        res.on("close", () => {
          void transport.close();
          void server.close();
        });
        await transport.handleRequest(req, res, parsed);
        return;
      }

      m.rpc = "get-sse";
      if (openStreams >= deps.rc.sseMaxStreams) {
        m.outcome = "rate_limited";
        req.resume();
        reject(res, 503, { "retry-after": "30" });
        return;
      }

      openStreams++;
      let opened: Awaited<ReturnType<typeof open>>;
      try {
        opened = await open({ ...deps.baseCtx, notices: [] });
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
      m.outcome = "rejected";
      m.kind = "INTERNAL";
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

export function releaseRemoteState(deps: RemoteDeps, handler: RemoteHandler): void {
  handler.closeStreams();
  deps.limiter.clear();
  void deps.baseCtx.cache.clear?.();
}
