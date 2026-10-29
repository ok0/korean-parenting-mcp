import type { Logger, LogMeta } from "../core/logger.js";
import { maskSecrets } from "../core/secrets.js";
import { DEFAULT_ACTIONS, type ErrorKind } from "../core/errors.js";
import { allTools } from "../tools/registry.js";
import type { GuardReason } from "./request-guard.js";

export type Rpc = "initialize" | "server/discover" | "tools/list" | "tools/call" | "get-sse" | "other";
export type Outcome = "ok" | "tool_error" | "rate_limited" | "rejected";
export type MetricsEvent =
  | {
      ev: "req";
      rpc: Rpc;
      tool?: string;
      http: number;
      outcome: Outcome;
      reason?: GuardReason | "body" | "parse";
      kind?: ErrorKind;
      ms: number;
      origin: "none" | "claude" | "other";
      proto?: string;
      metaProto?: string;
      pool?: "direct" | "shared";
    }
  | { ev: "start"; version: string }
  | { ev: "crash"; kind: string };
export interface MetricsLog {
  emit(e: MetricsEvent): void;
}

export const REQ_KEYS = [
  "ev",
  "rpc",
  "tool",
  "http",
  "outcome",
  "reason",
  "kind",
  "ms",
  "origin",
  "proto",
  "metaProto",
  "pool",
] as const;

export const ALLOWED_META_KEYS = [
  "tool",
  "ms",
  "spec",
  "code",
  "status",
  "fromCache",
  "count",
  "pages",
  "failed",
  "rows",
  "service",
  "requested",
  "live",
  "fallback",
  "kind",
  "host",
  "attempts",
  "basisId",
  "moon",
  "peds",
  "clinics",
  "services",
  "confirmed",
  "changed",
  "unavailable",
  "skipped",
] as const;

const RPCS: readonly string[] = ["initialize", "server/discover", "tools/list", "tools/call", "get-sse", "other"];
const OUTCOMES: readonly string[] = ["ok", "tool_error", "rate_limited", "rejected"];
const REASONS: readonly string[] = ["query", "host", "origin", "auth", "path", "method", "type", "body", "parse"];
const ORIGINS: readonly string[] = ["none", "claude", "other"];
const POOLS: readonly string[] = ["direct", "shared"];
const KINDS = new Set<string>(Object.keys(DEFAULT_ACTIONS));
const TOOL_NAMES = new Set<string>(allTools.map((t) => t.name));
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const NAME = /^[A-Za-z0-9_]{1,40}$/;
const VERSION_RE = /^[0-9A-Za-z.+-]{1,32}$/;
const MSG_RE = /^[A-Za-z0-9 ._:-]{1,60}$/;
const META_STR_RE = /^[A-Za-z0-9._:-]{1,40}$/;

function pick(v: unknown, list: readonly string[]): string | undefined {
  return typeof v === "string" && list.includes(v) ? v : undefined;
}

function buildReq(r: Record<string, unknown>): Record<string, unknown> {
  const rpc = pick(r.rpc, RPCS) ?? "other";
  const ms = typeof r.ms === "number" && Number.isFinite(r.ms) && r.ms >= 0 ? Math.round(r.ms) : 0;
  const http = typeof r.http === "number" && Number.isInteger(r.http) && r.http >= 100 && r.http <= 599 ? r.http : 0;
  const date = (v: unknown): string | undefined => (typeof v === "string" && DATE.test(v) ? v : undefined);
  const out: Record<string, unknown> = {
    ev: "req",
    rpc,
    tool:
      rpc === "tools/call"
        ? typeof r.tool === "string" && TOOL_NAMES.has(r.tool)
          ? r.tool
          : "unknown"
        : undefined,
    http,
    outcome: pick(r.outcome, OUTCOMES) ?? "rejected",
    reason: pick(r.reason, REASONS),
    kind: typeof r.kind === "string" && KINDS.has(r.kind) ? r.kind : undefined,
    ms,
    origin: pick(r.origin, ORIGINS) ?? "other",
    proto: date(r.proto),
    metaProto: date(r.metaProto),
    pool: pick(r.pool, POOLS),
  };
  const obj: Record<string, unknown> = {};
  for (const k of REQ_KEYS) if (out[k] !== undefined) obj[k] = out[k];
  return obj;
}

export function createMetricsLog(sink: (line: string) => void = (l) => {
  process.stdout.write(l);
}): MetricsLog {
  return {
    emit(e) {
      try {
        const r = e as unknown as Record<string, unknown>;
        let obj: Record<string, unknown> | undefined;
        if (r.ev === "req") obj = buildReq(r);
        else if (r.ev === "start")
          obj = {
            ev: "start",
            version: typeof r.version === "string" && VERSION_RE.test(r.version) ? r.version : "unknown",
          };
        else if (r.ev === "crash")
          obj = { ev: "crash", kind: typeof r.kind === "string" && NAME.test(r.kind) ? r.kind : "unknown" };
        if (obj === undefined) return;
        sink(JSON.stringify(obj) + "\n");
      } catch {
        return;
      }
    },
  };
}

export function createRemoteLogger(
  secrets: readonly string[],
  sink: (line: string) => void = (l) => {
    process.stderr.write(l);
  },
  toolNames: readonly string[] = [...TOOL_NAMES],
): Logger {
  const tools = new Set<string>(toolNames);
  const emit = (lvl: "info" | "warn" | "error", msg: string, meta?: LogMeta): void => {
    const safeMsg = MSG_RE.test(msg) ? msg : "log";
    const m: Record<string, string | number | boolean> = {};
    for (const k of ALLOWED_META_KEYS) {
      const v: unknown = meta?.[k];
      if (typeof v === "number") {
        if (Number.isFinite(v)) m[k] = v;
      } else if (typeof v === "boolean") {
        m[k] = v;
      } else if (typeof v === "string") {
        if (k === "tool") m[k] = tools.has(v) ? v : "unknown";
        else if (META_STR_RE.test(v)) m[k] = v;
      }
    }
    const keys = Object.keys(m);
    const line = `${new Date().toISOString()} ${lvl.toUpperCase()} ${safeMsg}${keys.length ? " " + JSON.stringify(m) : ""}\n`;
    sink(maskSecrets(line, secrets));
  };
  return {
    debug: () => {},
    info: (msg, meta) => emit("info", msg, meta),
    warn: (msg, meta) => emit("warn", msg, meta),
    error: (msg, meta) => emit("error", msg, meta),
  };
}

export function installCrashHandlers(
  proc: Pick<NodeJS.EventEmitter, "on">,
  metrics: MetricsLog,
  exit: (code: number) => void,
): void {
  let logged = false;
  const onCrash = (err: unknown): void => {
    if (!logged) {
      logged = true;
      try {
        metrics.emit({ ev: "crash", kind: err instanceof Error ? err.name : "unknown" });
      } catch {}
    }
    exit(1);
  };
  proc.on("uncaughtException", onCrash);
  proc.on("unhandledRejection", onCrash);
}
