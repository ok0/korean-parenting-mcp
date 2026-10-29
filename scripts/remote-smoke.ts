import { fileURLToPath } from "node:url";
import { formatReport, runRemoteSmoke, startLocalRemote, type LocalRemote, type SmokeCheck } from "./lib/remote-smoke.js";
import { EXIT, isMainModule, processIO, type ScriptIO } from "./lib/script-io.js";

const root = fileURLToPath(new URL("../../", import.meta.url));

const USAGE = [
  "사용법: npm run smoke:remote -- [baseUrl] [--expect-origin reject|allow] [--set NAME=VALUE]...",
  "  baseUrl 없이 실행하면 빌드된 원격 서버를 로컬에서 띄워 점검합니다(--set 사용 가능).",
  "  baseUrl 은 https 이거나, 127.0.0.1/localhost/[::1] 의 http 만 허용합니다.",
].join("\n");

const SET_NAME = /^(KPM_[A-Z0-9_]+|PORT)$/;
const FORBIDDEN_SET = new Set(["KPM_REMOTE_BEARER_TOKEN", "KPM_ALERT_WEBHOOK_URL"]);
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

interface ParsedArgs {
  baseUrl?: string;
  expectOrigin: "reject" | "allow";
  sets: Record<string, string>;
}

function validBaseUrl(raw: string): string | undefined {
  if (raw.includes("?") || raw.includes("#")) return "쿼리·프래그먼트는 쓸 수 없습니다";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "URL 형식이 아닙니다";
  }
  if (url.protocol === "https:") return undefined;
  if (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname)) return undefined;
  return "https 이거나 loopback 의 http 만 허용합니다";
}

function parseArgs(argv: readonly string[]): ParsedArgs | { error: string } {
  const parsed: ParsedArgs = { expectOrigin: "reject", sets: {} };
  let positional: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg === "--expect-origin") {
      const value = argv[i + 1];
      if (value !== "reject" && value !== "allow") return { error: "--expect-origin 은 reject 또는 allow 입니다" };
      parsed.expectOrigin = value;
      i++;
    } else if (arg === "--set") {
      const value = argv[i + 1] ?? "";
      const eq = value.indexOf("=");
      if (eq < 0) return { error: "--set 은 NAME=VALUE 형식이어야 합니다" };
      const name = value.slice(0, eq);
      if (!SET_NAME.test(name) || FORBIDDEN_SET.has(name)) return { error: `허용되지 않는 이름: ${name}` };
      parsed.sets[name] = value.slice(eq + 1);
      i++;
    } else if (arg.startsWith("--")) {
      return { error: `알 수 없는 옵션: ${arg}` };
    } else {
      if (positional !== undefined) return { error: "baseUrl 은 하나만 쓸 수 있습니다" };
      positional = arg;
    }
  }
  if (positional !== undefined) {
    const problem = validBaseUrl(positional);
    if (problem !== undefined) return { error: `baseUrl ${problem}` };
    if (Object.keys(parsed.sets).length > 0) return { error: "--set 은 baseUrl 없이(로컬 실행)만 쓸 수 있습니다" };
    parsed.baseUrl = positional;
  }
  return parsed;
}

function report(checks: readonly SmokeCheck[], io: ScriptIO): number {
  const { lines, ok } = formatReport(checks);
  for (const line of lines) {
    io.stdout(`${line}\n`);
    if (line.startsWith("FAIL")) io.stderr(`${line}\n`);
  }
  const passed = checks.filter((c) => c.ok).length;
  if (ok) {
    io.stdout(`REMOTE SMOKE PASS (${passed}/${checks.length})\n`);
    return EXIT.OK;
  }
  io.stderr(`REMOTE SMOKE FAIL (${passed}/${checks.length})\n`);
  return 1;
}

export async function main(argv: readonly string[], io: ScriptIO): Promise<number> {
  const parsed = parseArgs(argv);
  if ("error" in parsed) {
    io.stderr(`REMOTE SMOKE 사용법 오류: ${parsed.error}\n${USAGE}\n`);
    return EXIT.USAGE;
  }

  if (parsed.baseUrl !== undefined) {
    const checks = await runRemoteSmoke(parsed.baseUrl, { expectOrigin: parsed.expectOrigin });
    return report(checks, io);
  }

  let remote: LocalRemote;
  try {
    remote = await startLocalRemote({ root, extraEnv: parsed.sets });
  } catch {
    io.stderr("REMOTE SMOKE FAIL: 로컬 원격 서버 시작 실패\n  힌트: npm run build 를 먼저 실행하세요\n");
    return 1;
  }
  try {
    const checks = await runRemoteSmoke(remote.baseUrl, { expectOrigin: parsed.expectOrigin });
    return report(checks, io);
  } finally {
    await remote.stop();
  }
}

if (isMainModule(import.meta.url)) {
  void main(process.argv.slice(2), processIO()).then((c) => {
    process.exitCode = c;
  });
}
