export type KeyName = "DATA_GO_KR" | "KINDERGARTEN" | "LAW_OC";
export type KeyEnvName = "DATA_GO_KR_SERVICE_KEY" | "KINDERGARTEN_API_KEY" | "LAW_OC";
export const KEY_ENV: Record<KeyName, KeyEnvName> = { DATA_GO_KR: "DATA_GO_KR_SERVICE_KEY", KINDERGARTEN: "KINDERGARTEN_API_KEY", LAW_OC: "LAW_OC" };
export type LogLevel = "debug" | "info" | "warn" | "error";
export interface Config {
  keys: Partial<Record<KeyName, string>>;
  maxResponseChars: number;
  httpTimeoutMs: number;
  lawCheckTimeoutMs: number;
  chainDeadlineMs: number;
  logLevel: LogLevel;
}

const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

function readInt(env: Record<string, string | undefined>, name: string, def: number, min: number, max: number): number {
  const raw = env[name]?.trim();
  if (raw === undefined || !/^-?\d+$/.test(raw)) return def;
  const n = Number(raw);
  return Math.min(max, Math.max(min, n));
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const keys: Partial<Record<KeyName, string>> = {};
  for (const name of Object.keys(KEY_ENV) as KeyName[]) {
    const value = env[KEY_ENV[name]]?.trim();
    if (value) keys[name] = value;
  }
  const rawLevel = env.KPM_LOG_LEVEL?.trim().toLowerCase();
  const logLevel = LOG_LEVELS.find((l) => l === rawLevel) ?? "warn";
  return {
    keys,
    maxResponseChars: readInt(env, "KPM_MAX_RESPONSE_CHARS", 8000, 1000, 50000),
    httpTimeoutMs: readInt(env, "KPM_HTTP_TIMEOUT_MS", 8000, 1000, 60000),
    lawCheckTimeoutMs: readInt(env, "KPM_LAW_TIMEOUT_MS", 3000, 500, 30000),
    chainDeadlineMs: readInt(env, "KPM_CHAIN_DEADLINE_MS", 15000, 1000, 60000),
    logLevel,
  };
}

export function secretsOf(config: Config): string[] {
  return Object.values(config.keys).filter((v): v is string => v !== undefined);
}
