import { loadConfig, secretsOf } from "../../src/core/config.js";
import type { ToolContext } from "../../src/core/context.js";
import { createLogger } from "../../src/core/logger.js";

export function createTestContext(opts?: {
  env?: Record<string, string>;
  sink?: (line: string) => void;
}): ToolContext {
  const config = loadConfig(opts?.env ?? {});
  const secrets = secretsOf(config);
  return {
    config,
    secrets,
    clock: { now: () => new Date("2026-01-01T00:00:00+09:00") },
    fetch: async () => {
      throw new Error("network disabled in tests");
    },
    log: createLogger(secrets, "debug", opts?.sink),
  };
}
