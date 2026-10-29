import { isIP } from "node:net";
import { loadConfig, secretsOf, type Config, type KeyName } from "../core/config.js";
import { KEY_GUIDE } from "../core/errors.js";
import {
  UPSTREAM_BUCKETS,
  DEFAULT_BUDGETS,
  DEFAULT_MIN_TTL_MS,
  DEFAULT_MIN_TTL_FALLBACK_MS,
  DEFAULT_STALE_MAX_MS,
  DEFAULT_ALERT_RATIO,
  type QuotaConfig,
  type UpstreamBucket,
} from "../core/upstream-guard.js";
import { REMOTE_POLICY, type RemotePolicy } from "./allowlist.js";
import type { HostingDisclosure } from "./privacy.js";

export const DEFAULT_HTTP_PORT = 8080;
export const MAX_DISCLOSURE_LENGTH = 200;
export const SSE_MAX_MS = 60_000;
export const SSE_MAX_MS_RANGE = [1_000, 300_000] as const;
export const DEFAULT_DAILY_REQUEST_CAP = 10_000;
export const DEFAULT_XFF_CLIENT_INDEX = 1;
export const SSE_MAX_STREAMS = 32;
export const MIN_BEARER_TOKEN_LENGTH = 32;
export const DEFAULT_MAX_BODY_BYTES = 65_536;
export const DEFAULT_RATE = { perClientPerMin: 30, sharedPoolPerMin: 600, globalPerMin: 900, maxConcurrent: 16 } as const;
export const DEFAULT_TRUSTED_PROXY_CIDRS = ["127.0.0.0/8", "::1/128", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7"];
export const DEFAULT_SHARED_EGRESS_CIDRS = ["160.79.104.0/21"];
export const REMOTE_CACHE_MAX_ENTRIES = 5000;
export const BUCKET_ENV: Readonly<Record<UpstreamBucket, string>> = {
  nemcList: "NEMC_LIST",
  nemcMoonlight: "NEMC_MOONLIGHT",
  benefits: "BENEFITS",
  dur: "DUR",
  kasi: "KASI",
  law: "LAW",
  kindergarten: "KINDERGARTEN",
  safetykorea: "SAFETYKOREA",
};

export interface RemoteConfig {
  base: Config; secrets: string[]; port: number; host: string;
  allowedHosts: string[]; allowedOrigins: string[]; bearerToken?: string;
  trustProxy: "none" | "xff"; originPolicy: "strict" | "report"; getMode: "sse" | "405";
  sseMaxMs: number; sseMaxStreams: number;
  trustedProxyCidrs: string[]; sharedEgressCidrs: string[]; maxBodyBytes: number;
  xffClientIndexFromRight: number; dailyRequestCap: number; lawRemote: boolean;
  rate: { perClientPerMin: number; sharedPoolPerMin: number; globalPerMin: number; maxConcurrent: number };
  quota: QuotaConfig;
  hosting: HostingDisclosure; operatorContact: string;
}

export class RemoteConfigError extends Error {
  constructor(readonly item: string) {
    super(`invalid remote config: ${item}`);
    this.name = "RemoteConfigError";
  }
}

function opt(env: Record<string, string | undefined>, name: string): string | undefined {
  const value = env[name]?.trim();
  return value === "" ? undefined : value;
}

function requiredText(env: Record<string, string | undefined>, name: string): string {
  const value = opt(env, name);
  if (value === undefined || value.length > MAX_DISCLOSURE_LENGTH || /[\u0000-\u001f\u007f-\u009f]/.test(value)) {
    throw new RemoteConfigError(name);
  }
  return value;
}

function splitList(raw: string): string[] {
  return raw.split(",").map((s) => s.trim().toLowerCase()).filter((s) => s !== "");
}

function choice<T extends string>(env: Record<string, string | undefined>, name: string, allowed: readonly T[], def: T): T {
  const value = opt(env, name);
  if (value === undefined) return def;
  const found = allowed.find((a) => a === value);
  if (found === undefined) throw new RemoteConfigError(name);
  return found;
}

function strictInt(env: Record<string, string | undefined>, name: string, def: number, min: number, max: number): number {
  const value = opt(env, name);
  if (value === undefined) return def;
  const n = Number(value);
  if (!/^\d+$/.test(value) || n < min || n > max) throw new RemoteConfigError(name);
  return n;
}

function isCidr(s: string): boolean {
  const slash = s.indexOf("/");
  if (slash < 0 || s.indexOf("/", slash + 1) >= 0) return false;
  const addr = s.slice(0, slash);
  const prefix = s.slice(slash + 1);
  const v = isIP(addr);
  if (v === 0) return false;
  return /^\d+$/.test(prefix) && Number(prefix) <= (v === 4 ? 32 : 128);
}

function cidrList(env: Record<string, string | undefined>, name: string, def: readonly string[]): string[] {
  const raw = opt(env, name);
  if (raw === undefined) return [...def];
  const list = splitList(raw);
  if (list.length === 0 || !list.every(isCidr)) throw new RemoteConfigError(name);
  return list;
}

export function restrictKeys(config: Config, policy: readonly RemotePolicy[] = REMOTE_POLICY): Config {
  const keys = { ...config.keys };
  for (const k of Object.keys(KEY_GUIDE) as KeyName[]) {
    const tools = KEY_GUIDE[k].tools;
    const excluded = tools.length > 0 && tools.every((t) => policy.find((p) => p.tool === t)?.expose === false);
    if (excluded) delete keys[k];
  }
  return { ...config, keys };
}

const HOST_PATTERN = /^([a-z0-9-]+\.)*[a-z0-9-]+$|^\[[0-9a-f:]+\]$/;

export function loadRemoteConfig(env: Record<string, string | undefined>): RemoteConfig {
  const rawPort = opt(env, "KPM_HTTP_PORT");
  const rawPortFallback = rawPort === undefined ? opt(env, "PORT") : undefined;
  const portName = rawPort !== undefined ? "KPM_HTTP_PORT" : "PORT";
  const portText = rawPort ?? rawPortFallback;
  let port = DEFAULT_HTTP_PORT;
  if (portText !== undefined) {
    const n = Number(portText);
    if (!/^\d+$/.test(portText) || n < 0 || n > 65535) throw new RemoteConfigError(portName);
    port = n;
  }

  const host = opt(env, "KPM_HTTP_HOST") ?? "127.0.0.1";

  let allowedHosts: string[];
  const rawHosts = opt(env, "KPM_ALLOWED_HOSTS");
  if (rawHosts === undefined) {
    allowedHosts = ["localhost", "127.0.0.1"];
  } else {
    allowedHosts = splitList(rawHosts);
    if (allowedHosts.length === 0 || !allowedHosts.every((h) => HOST_PATTERN.test(h))) {
      throw new RemoteConfigError("KPM_ALLOWED_HOSTS");
    }
  }

  let allowedOrigins: string[];
  const rawOrigins = opt(env, "KPM_ALLOWED_ORIGINS");
  if (rawOrigins === undefined) {
    allowedOrigins = ["https://claude.ai", "https://claude.com"];
  } else {
    allowedOrigins = splitList(rawOrigins).map((s) => s.replace(/\/+$/, "")).filter((s) => s !== "");
    for (const n of allowedOrigins) {
      let url: URL;
      try {
        url = new URL(n);
      } catch {
        throw new RemoteConfigError("KPM_ALLOWED_ORIGINS");
      }
      if ((url.protocol !== "https:" && url.protocol !== "http:") || url.origin !== n) {
        throw new RemoteConfigError("KPM_ALLOWED_ORIGINS");
      }
    }
  }
  const selfOrigin = `https://${allowedHosts[0]}`;
  if (!allowedOrigins.includes(selfOrigin)) allowedOrigins.push(selfOrigin);

  const rawToken = opt(env, "KPM_REMOTE_BEARER_TOKEN");
  if (rawToken !== undefined && rawToken.length < MIN_BEARER_TOKEN_LENGTH) {
    throw new RemoteConfigError("KPM_REMOTE_BEARER_TOKEN");
  }

  const trustProxy = choice(env, "KPM_TRUST_PROXY", ["none", "xff"] as const, "none");
  const originPolicy = choice(env, "KPM_ORIGIN_POLICY", ["strict", "report"] as const, "strict");
  const getMode = choice(env, "KPM_GET_MODE", ["sse", "405"] as const, "sse");

  const trustedProxyCidrs = cidrList(env, "KPM_TRUSTED_PROXY_CIDRS", DEFAULT_TRUSTED_PROXY_CIDRS);
  const sharedEgressCidrs = cidrList(env, "KPM_SHARED_EGRESS_CIDRS", DEFAULT_SHARED_EGRESS_CIDRS);
  const maxBodyBytes = strictInt(env, "KPM_MAX_BODY_BYTES", DEFAULT_MAX_BODY_BYTES, 1024, 1_048_576);
  const rate = {
    perClientPerMin: strictInt(env, "KPM_RATE_PER_CLIENT_PER_MIN", 30, 1, 100_000),
    sharedPoolPerMin: strictInt(env, "KPM_RATE_SHARED_POOL_PER_MIN", 600, 1, 100_000),
    globalPerMin: strictInt(env, "KPM_RATE_GLOBAL_PER_MIN", 900, 1, 100_000),
    maxConcurrent: strictInt(env, "KPM_RATE_MAX_CONCURRENT", 16, 1, 1_000),
  };
  const xffClientIndexFromRight = strictInt(env, "KPM_XFF_CLIENT_INDEX", 1, 1, 32);
  const dailyRequestCap = strictInt(env, "KPM_DAILY_REQUEST_CAP", 10_000, 1, 100_000_000);
  const sseMaxMs = strictInt(env, "KPM_SSE_MAX_MS", SSE_MAX_MS, SSE_MAX_MS_RANGE[0], SSE_MAX_MS_RANGE[1]);
  const lawRemote = choice(env, "KPM_LAW_REMOTE", ["on", "off"] as const, "off") === "on";

  const budgets = Object.fromEntries(
    UPSTREAM_BUCKETS.map((b) => [b, strictInt(env, `KPM_BUDGET_${BUCKET_ENV[b]}`, DEFAULT_BUDGETS[b], 0, 10_000_000)]),
  ) as Record<UpstreamBucket, number>;
  const minTtlMs = Object.fromEntries(
    UPSTREAM_BUCKETS.map((b) => [
      b,
      strictInt(env, `KPM_MIN_TTL_${BUCKET_ENV[b]}_MS`, DEFAULT_MIN_TTL_MS[b], 1, 604_800_000),
    ]),
  ) as Record<UpstreamBucket, number>;
  const defaultMinTtlMs = strictInt(env, "KPM_MIN_TTL_DEFAULT_MS", DEFAULT_MIN_TTL_FALLBACK_MS, 1, 604_800_000);
  const rawRatio = opt(env, "KPM_ALERT_RATIO");
  let alertRatio = DEFAULT_ALERT_RATIO;
  if (rawRatio !== undefined) {
    const n = Number(rawRatio);
    if (!/^\d+(\.\d+)?$/.test(rawRatio) || !(n > 0 && n <= 1)) throw new RemoteConfigError("KPM_ALERT_RATIO");
    alertRatio = n;
  }
  const webhook = opt(env, "KPM_ALERT_WEBHOOK_URL");
  if (webhook !== undefined) {
    let parsed: URL;
    try {
      parsed = new URL(webhook);
    } catch {
      throw new RemoteConfigError("KPM_ALERT_WEBHOOK_URL");
    }
    if (parsed.protocol !== "https:" || /\s/.test(webhook)) throw new RemoteConfigError("KPM_ALERT_WEBHOOK_URL");
  }
  const quota: QuotaConfig = {
    budgets,
    minTtlMs,
    defaultMinTtlMs,
    staleMaxMs: DEFAULT_STALE_MAX_MS,
    alertRatio,
    ...(webhook !== undefined ? { alertWebhookUrl: webhook } : {}),
  };

  const operatorContact = requiredText(env, "KPM_OPERATOR_CONTACT");
  const hostingText = {
    provider: requiredText(env, "KPM_HOST_PROVIDER"),
    country: requiredText(env, "KPM_HOST_COUNTRY"),
    region: requiredText(env, "KPM_HOST_REGION"),
    logRetention: requiredText(env, "KPM_HOST_LOG_RETENTION"),
  };
  const requestLogs = opt(env, "KPM_HOST_REQUEST_LOGS");
  if (requestLogs !== "excluded" && requestLogs !== "retained") throw new RemoteConfigError("KPM_HOST_REQUEST_LOGS");
  const hosting: HostingDisclosure = { ...hostingText, requestLogs };

  const loaded = loadConfig(env);
  const base = restrictKeys(loaded);
  const secrets = [
    ...secretsOf(loaded),
    ...(rawToken !== undefined ? [rawToken] : []),
    ...(webhook !== undefined ? [webhook] : []),
  ];

  const config: RemoteConfig = {
    base, secrets, port, host, allowedHosts, allowedOrigins,
    trustProxy, originPolicy, getMode,
    sseMaxMs, sseMaxStreams: SSE_MAX_STREAMS,
    trustedProxyCidrs, sharedEgressCidrs, maxBodyBytes, rate, quota,
    xffClientIndexFromRight, dailyRequestCap, lawRemote,
    hosting, operatorContact,
  };
  if (rawToken !== undefined) config.bearerToken = rawToken;
  return config;
}
