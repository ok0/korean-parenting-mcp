import type { LogLevel } from "./config.js";
import { maskSecrets } from "./secrets.js";

export type LogMeta = Record<string, string | number | boolean>;

export interface Logger {
  debug(msg: string, meta?: LogMeta): void;
  info(msg: string, meta?: LogMeta): void;
  warn(msg: string, meta?: LogMeta): void;
  error(msg: string, meta?: LogMeta): void;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export function createLogger(
  secrets: readonly string[],
  level: LogLevel = "warn",
  sink: (line: string) => void = (l) => {
    process.stderr.write(l);
  },
): Logger {
  const emit = (lvl: LogLevel, msg: string, meta?: LogMeta): void => {
    if (LEVEL_ORDER[lvl] < LEVEL_ORDER[level]) return;
    const line = `${new Date().toISOString()} ${lvl.toUpperCase()} ${msg}${meta ? " " + JSON.stringify(meta) : ""}\n`;
    sink(maskSecrets(line, secrets));
  };
  return {
    debug: (msg, meta) => emit("debug", msg, meta),
    info: (msg, meta) => emit("info", msg, meta),
    warn: (msg, meta) => emit("warn", msg, meta),
    error: (msg, meta) => emit("error", msg, meta),
  };
}
