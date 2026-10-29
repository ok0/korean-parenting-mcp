import { loadConfig, secretsOf, type Config } from "../core/config.js";

export const DEFAULT_HTTP_PORT = 8080;
export const SSE_MAX_MS = 300_000;
export const SSE_MAX_STREAMS = 32;
export const MIN_BEARER_TOKEN_LENGTH = 32;

export interface RemoteConfig {
  base: Config; secrets: string[]; port: number; host: string;
  allowedHosts: string[]; allowedOrigins: string[]; bearerToken?: string;
  trustProxy: "none" | "xff"; originPolicy: "strict" | "report"; getMode: "sse" | "405";
  sseMaxMs: number; sseMaxStreams: number;
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

  const base = loadConfig(env);
  const secrets = [...secretsOf(base), ...(rawToken !== undefined ? [rawToken] : [])];

  const config: RemoteConfig = {
    base, secrets, port, host, allowedHosts, allowedOrigins,
    trustProxy, originPolicy, getMode,
    sseMaxMs: SSE_MAX_MS, sseMaxStreams: SSE_MAX_STREAMS,
  };
  if (rawToken !== undefined) config.bearerToken = rawToken;
  return config;
}
