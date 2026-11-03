import { posix, win32 } from "node:path";
import { KEY_ENV, type KeyEnvName } from "../core/config.js";

export const SERVER_NAME = "korean-parenting";
export const PACKAGE_NAME = "korean-parenting-mcp";

export interface ServerEntry {
  command: "npx";
  args: ["-y", "korean-parenting-mcp"];
  env: Partial<Record<KeyEnvName, string>>;
}

const KEY_NAMES = Object.values(KEY_ENV) as KeyEnvName[];

export function buildServerEntry(input: Partial<Record<KeyEnvName, string | undefined>>): ServerEntry {
  const env: Partial<Record<KeyEnvName, string>> = {};
  for (const name of KEY_NAMES) {
    const value = input[name]?.trim();
    if (value) env[name] = value;
  }
  return { command: "npx", args: ["-y", "korean-parenting-mcp"], env };
}

export function resolveHome(
  env: Record<string, string | undefined>,
  homedir: () => string,
): { home: string; overridden: boolean } {
  const override = env.KPM_SETUP_HOME?.trim();
  if (override) return { home: override, overridden: true };
  return { home: homedir(), overridden: false };
}

export function desktopConfigPath(
  home: string,
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
  overridden: boolean,
): string {
  if (platform === "darwin") {
    return posix.join(home, "Library/Application Support/Claude/claude_desktop_config.json");
  }
  if (platform === "win32") {
    const base = overridden
      ? win32.join(home, "AppData", "Roaming")
      : (env.APPDATA?.trim() || win32.join(home, "AppData", "Roaming"));
    return win32.join(base, "Claude", "claude_desktop_config.json");
  }
  return posix.join(home, ".config/Claude/claude_desktop_config.json");
}

export type MergeResult = { ok: true; text: string; replaced: boolean } | { ok: false; reason: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function mergeDesktopConfig(existing: string | undefined, entry: ServerEntry): MergeResult {
  if (existing === undefined) {
    const obj = { mcpServers: { [SERVER_NAME]: entry } };
    return { ok: true, text: JSON.stringify(obj, null, 2) + "\n", replaced: false };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(existing);
  } catch {
    return { ok: false, reason: "JSON 문법 오류로 파일을 읽을 수 없습니다" };
  }
  if (!isPlainObject(parsed)) {
    return { ok: false, reason: "최상위 값은 JSON 객체여야 합니다" };
  }
  let servers: Record<string, unknown>;
  if (Object.hasOwn(parsed, "mcpServers")) {
    const current = parsed.mcpServers;
    if (!isPlainObject(current)) {
      return { ok: false, reason: "mcpServers 값은 JSON 객체여야 합니다" };
    }
    servers = current;
  } else {
    servers = {};
    parsed.mcpServers = servers;
  }
  const replaced = Object.hasOwn(servers, SERVER_NAME);
  servers[SERVER_NAME] = entry;
  return { ok: true, text: JSON.stringify(parsed, null, 2) + "\n", replaced };
}

export function claudeCodeArgs(entry: ServerEntry): string[] {
  const envArgs: string[] = [];
  for (const name of KEY_NAMES) {
    const value = entry.env[name];
    if (value !== undefined) envArgs.push("--env", `${name}=${value}`);
  }
  return ["mcp", "add", "--transport", "stdio", "--scope", "user", ...envArgs, SERVER_NAME, "--", "npx", "-y", PACKAGE_NAME];
}

export function manualClaudeCommand(entry: ServerEntry): string {
  let cmd = "claude mcp add --transport stdio --scope user";
  for (const name of KEY_NAMES) {
    if (entry.env[name] !== undefined) cmd += ` --env "${name}=<${name}>"`;
  }
  cmd += ` ${SERVER_NAME} -- npx -y ${PACKAGE_NAME}`;
  return cmd;
}

export function parseTargetSelection(text: string): { ok: true; desktop: boolean; code: boolean } | { ok: false } {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: true, desktop: false, code: false };
  const tokens = trimmed.split(/[\s,]+/);
  if (!tokens.every((t) => t === "1" || t === "2")) return { ok: false };
  return { ok: true, desktop: tokens.includes("1"), code: tokens.includes("2") };
}
