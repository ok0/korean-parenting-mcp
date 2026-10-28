import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { TtlCache } from "../../src/core/cache.js";
import { loadConfig, secretsOf } from "../../src/core/config.js";
import type { ToolContext } from "../../src/core/context.js";
import { createLogger } from "../../src/core/logger.js";
import { maskSecrets } from "../../src/core/secrets.js";

export const EXIT = { OK: 0, USAGE: 1, UNAVAILABLE: 2, CHANGED: 10 } as const;

export interface ScriptIO {
  env: Record<string, string | undefined>;
  fetch: typeof fetch;
  now: () => Date;
  stdout(text: string): void;
  stderr(text: string): void;
}

export function processIO(): ScriptIO {
  return {
    env: process.env,
    fetch: globalThis.fetch.bind(globalThis),
    now: () => new Date(),
    stdout: (text) => {
      process.stdout.write(text);
    },
    stderr: (text) => {
      process.stderr.write(text);
    },
  };
}

export interface ScriptContext {
  ctx: ToolContext;
  out(text: string): void;
  err(text: string): void;
  mask(text: string): string;
}

export function createScriptContext(io: ScriptIO): ScriptContext {
  const config = loadConfig(io.env);
  const secrets = secretsOf(config);
  const ctx: ToolContext = {
    config,
    secrets,
    clock: { now: io.now },
    fetch: io.fetch,
    cache: new TtlCache(),
    log: createLogger(secrets, config.logLevel, (l) => io.stderr(maskSecrets(l, secrets))),
  };
  const mask = (text: string): string => maskSecrets(text, secrets);
  return {
    ctx,
    mask,
    out: (text) => io.stdout(mask(text)),
    err: (text) => io.stderr(mask(text)),
  };
}

export function parseFlags(argv: readonly string[], known: readonly string[]): { flags: Record<string, string> } | { error: string } {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i] ?? "";
    if (!known.includes(name)) return { error: `알 수 없는 옵션: ${name}` };
    const value = argv[i + 1];
    if (value === undefined) return { error: `값이 없는 옵션: ${name}` };
    flags[name] = value;
    i++;
  }
  return { flags };
}

export function isMainModule(metaUrl: string): boolean {
  const entry = process.argv[1];
  return entry !== undefined && pathToFileURL(resolve(entry)).href === metaUrl;
}
