import { TtlCache, type CacheStore } from "./cache.js";
import { secretsOf, type Config } from "./config.js";
import type { ErrorKind } from "./errors.js";
import { createLogger, type Logger } from "./logger.js";
import type { UpstreamGuard } from "./upstream-guard.js";

export interface Clock {
  now(): Date;
}

export interface ToolContext {
  config: Config;
  clock: Clock;
  fetch: typeof fetch;
  cache: CacheStore;
  upstream?: UpstreamGuard;
  notices?: string[];
  log: Logger;
  secrets: string[];
  onToolDone?: (e: { tool: string; ok: boolean; kind?: ErrorKind; ms: number }) => void;
  revisionCheck?: "remote-unavailable"; // remote only (M28): skip law.go.kr revision checks
}

export function createDefaultContext(config: Config, overrides: Partial<ToolContext> = {}): ToolContext {
  const secrets = secretsOf(config);
  return {
    config,
    clock: { now: () => new Date() },
    fetch: globalThis.fetch.bind(globalThis),
    cache: new TtlCache(),
    secrets,
    log: createLogger(secrets, config.logLevel),
    ...overrides,
  };
}
