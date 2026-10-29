import { isIP } from "node:net";
import { loadConfig, secretsOf, type Config, type KeyName } from "../core/config.js";
import { KEY_GUIDE } from "../core/errors.js";
import { REMOTE_POLICY, type RemotePolicy } from "./allowlist.js";

export const DEFAULT_HTTP_PORT = 8080;
export const SSE_MAX_MS = 300_000;
export const SSE_MAX_STREAMS = 32;
export const MIN_BEARER_TOKEN_LENGTH = 32;
export const DEFAULT_MAX_BODY_BYTES = 65_536;
export const DEFAULT_RATE = { perClientPerMin: 30, sharedPoolPerMin: 600, globalPerMin: 900, maxConcurrent: 16 } as const;
export const DEFAULT_TRUSTED_PROXY_CIDRS = ["127.0.0.0/8", "::1/128", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7"];
export const DEFAULT_SHARED_EGRESS_CIDRS = ["160.79.104.0/21"];

export interface RemoteConfig {
  base: Config; secrets: string[]; port: number; host: string;
  allowedHosts: string[]; allowedOrigins: string[]; bearerToken?: string;
  trustProxy: "none" | "xff"; originPolicy: "strict" | "report"; getMode: "sse" | "405";
  sseMaxMs: number; sseMaxStreams: number;
  trustedProxyCidrs: string[]; sharedEgressCidrs: string[]; maxBodyBytes: number;
  rate: { perClientPerMin: number; sharedPoolPerMin: number; globalPerMin: number; maxConcurrent: number };
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
  let port = DEFAULT_HTTP_PORT;
  if (rawPort !== undefined) {
    const n = Number(rawPort);
    if (!/^\d+$/.test(rawPort) || n < 0 || n > 65535) throw new RemoteConfigError("KPM_HTTP_PORT");
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

  const loaded = loadConfig(env);
  const base = restrictKeys(loaded);
  const secrets = [...secretsOf(loaded), ...(rawToken !== undefined ? [rawToken] : [])];

  const config: RemoteConfig = {
    base, secrets, port, host, allowedHosts, allowedOrigins,
    trustProxy, originPolicy, getMode,
    sseMaxMs: SSE_MAX_MS, sseMaxStreams: SSE_MAX_STREAMS,
    trustedProxyCidrs, sharedEgressCidrs, maxBodyBytes, rate,
  };
  if (rawToken !== undefined) config.bearerToken = rawToken;
  return config;
}
