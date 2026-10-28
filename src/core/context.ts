import { secretsOf, type Config } from "./config.js";
import { createLogger, type Logger } from "./logger.js";

export interface Clock {
  now(): Date;
}

export interface ToolContext {
  config: Config;
  clock: Clock;
  fetch: typeof fetch;
  log: Logger;
  secrets: string[];
}

export function createDefaultContext(config: Config, overrides: Partial<ToolContext> = {}): ToolContext {
  const secrets = secretsOf(config);
  return {
    config,
    clock: { now: () => new Date() },
    fetch: globalThis.fetch.bind(globalThis),
    secrets,
    log: createLogger(secrets, config.logLevel),
    ...overrides,
  };
}
