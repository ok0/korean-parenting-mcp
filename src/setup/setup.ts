import * as fsp from "node:fs/promises";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { KEY_ENV, type KeyEnvName, type KeyName } from "../core/config.js";
import { KEY_GUIDE } from "../core/errors.js";
import { maskKey, maskSecrets } from "../core/secrets.js";
import {
  SetupAbortError,
  createTerminalIO,
  type SetupIO,
} from "./terminal.js";
import {
  buildServerEntry,
  claudeCodeArgs,
  desktopConfigPath,
  manualClaudeCommand,
  mergeDesktopConfig,
  parseTargetSelection,
  resolveHome,
  type MergeResult,
  type ServerEntry,
} from "./targets.js";

export interface SetupFs {
  readFile(p: string): Promise<string>;
  writeFile(p: string, data: string, opts: { mode: number }): Promise<void>;
  copyFile(src: string, dst: string): Promise<void>;
  mkdir(p: string, opts: { recursive: true }): Promise<unknown>;
  chmod(p: string, mode: number): Promise<void>;
  exists(p: string): Promise<boolean>;
}

export const nodeFs: SetupFs = {
  readFile: (p) => fsp.readFile(p, "utf8"),
  writeFile: (p, data, opts) => fsp.writeFile(p, data, opts),
  copyFile: (src, dst) => fsp.copyFile(src, dst),
  mkdir: (p, opts) => fsp.mkdir(p, opts),
  chmod: (p, mode) => fsp.chmod(p, mode),
  exists: (p) => fsp.stat(p).then(
    () => true,
    () => false,
  ),
};

export interface RunSetupOptions {
  io?: SetupIO;
  fs?: SetupFs;
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  homedir?: () => string;
}

export const NON_TTY_MESSAGE =
  "설정 마법사는 대화형 터미널에서만 실행할 수 있습니다. 터미널에서 다시 실행하세요: npx -y korean-parenting-mcp setup";
export const ARGS_NOTICE =
  "안내: Claude Code 등록 시 입력한 키가 claude 명령 인자로 잠시 전달되어, 실행 중 같은 컴퓨터의 프로세스 목록에 보일 수 있습니다. 화면과 로그에는 출력하지 않습니다.";
export const RESTART_NOTICE =
  "Claude Desktop은 앱을 완전히 종료한 뒤 다시 실행해야 설정이 적용됩니다.";

type Say = (text: string) => void;
type DesktopStatus = "기록됨" | "교체됨" | "실패";
type ClaudeCodeStatus = "등록됨" | "실패";

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function writeDesktop(
  fs: SetupFs,
  p: string,
  entry: ServerEntry,
  say: Say,
  warn: Say,
): Promise<DesktopStatus> {
  const tryChmod = async (x: string): Promise<void> => {
    try {
      await fs.chmod(x, 0o600);
    } catch {
      warn(
        `경고: 파일 권한(0o600)을 지정하지 못했습니다: ${x} — 다른 사용자가 읽을 수 없도록 직접 권한을 확인하세요.`,
      );
    }
  };

  let existing: string | undefined;
  try {
    existing = (await fs.exists(p)) ? await fs.readFile(p) : undefined;
  } catch (e) {
    warn(`Claude Desktop 설정 기록 실패: ${errorMessage(e)}`);
    return "실패";
  }

  const m: MergeResult = mergeDesktopConfig(existing, entry);
  if (!m.ok) {
    warn(
      `Claude Desktop 설정 파일을 수정하지 않았습니다: ${m.reason}\n파일: ${p}\n파일의 JSON 문법을 고치거나 다른 이름으로 옮긴 뒤 마법사를 다시 실행하세요. 직접 고치려면 최상위 "mcpServers" 객체 안에 "korean-parenting" 항목({"command":"npx","args":["-y","korean-parenting-mcp"],"env":{…}})을 추가하세요.`,
    );
    return "실패";
  }

  try {
    if (existing !== undefined) {
      await fs.copyFile(p, p + ".bak");
      await tryChmod(p + ".bak");
      say(`백업: ${p}.bak`);
    } else {
      await fs.mkdir(dirname(p), { recursive: true });
    }
    await fs.writeFile(p, m.text, { mode: 0o600 });
    await tryChmod(p);
  } catch (e) {
    warn(`Claude Desktop 설정 기록 실패: ${errorMessage(e)}`);
    return "실패";
  }

  if (m.replaced) say("기존 korean-parenting 항목을 새 값으로 교체했습니다.");
  return m.replaced ? "교체됨" : "기록됨";
}

async function registerClaudeCode(
  io: SetupIO,
  entry: ServerEntry,
  codeFound: boolean,
  say: Say,
  warn: Say,
): Promise<ClaudeCodeStatus> {
  if (!codeFound) {
    warn(
      "claude 명령을 찾지 못해 Claude Code에 등록하지 않았습니다. Claude Code 설치 후 아래 명령을 실행하세요(<…> 자리를 실제 키로 바꾸세요):",
    );
    say(manualClaudeCommand(entry));
    return "실패";
  }

  say(ARGS_NOTICE);
  const r = await io.exec("claude", claudeCodeArgs(entry));
  if (!r.notFound && r.code === 0) return "등록됨";

  warn(`Claude Code 등록 실패(종료 코드 ${r.code ?? "없음"}):`);
  const detail = (r.stderr || r.stdout).trim().slice(0, 2000);
  if (detail) warn(detail);
  warn("이미 등록된 경우 먼저 실행하세요: claude mcp remove korean-parenting --scope user");
  warn("수동 등록 명령(<…> 자리를 실제 키로 바꾸세요):");
  say(manualClaudeCommand(entry));
  return "실패";
}

export async function runSetup(opts: RunSetupOptions = {}): Promise<number> {
  const io: SetupIO = opts.io ?? createTerminalIO();
  const fs: SetupFs = opts.fs ?? nodeFs;
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const home = opts.homedir ?? homedir;
  const secrets: string[] = [];
  const say: Say = (t) => io.out(maskSecrets(t, secrets));
  const warn: Say = (t) => io.err(maskSecrets(t, secrets));

  if (!io.interactive) {
    io.err(NON_TTY_MESSAGE);
    io.close();
    return 2;
  }

  try {
    const { home: h, overridden } = resolveHome(env, home);
    const desktopPath = desktopConfigPath(h, platform, env, overridden);

    say("korean-parenting-mcp 설정 마법사 (비공식 도구)");
    say(
      "API 키는 모두 선택 사항입니다. Enter로 건너뛸 수 있고, 키 없이도 get_timeline은 동작합니다. 입력한 키는 화면에 표시되지 않습니다.",
    );

    const keys: Partial<Record<KeyEnvName, string>> = {};
    const names = Object.keys(KEY_ENV) as KeyName[];
    for (const [i, name] of names.entries()) {
      const g = KEY_GUIDE[name];
      say(`\n[${i + 1}/${names.length}] ${g.title} (${g.env}) — 선택`);
      say(`발급: ${g.url}`);
      for (const s of g.steps) say(`  - ${s}`);
      const raw = await io.prompt(`${g.env} 값 (건너뛰려면 Enter): `, { mask: true });
      const v = raw.trim();
      if (v) {
        keys[g.env] = v;
        secrets.push(v);
        say(`  입력됨: ${maskKey(v)}`);
      } else {
        say("  건너뜀");
      }
    }

    const entry = buildServerEntry(keys);

    const desktopFound = await fs.exists(desktopPath);
    const ver = await io.exec("claude", ["--version"]);
    const codeFound = !ver.notFound && ver.code === 0;

    say("\n등록할 대상:");
    say(`  1) Claude Desktop — ${desktopPath}${desktopFound ? " [감지됨]" : ""}`);
    say(`  2) Claude Code (사용자 범위, claude mcp add)${codeFound ? " [감지됨]" : ""}`);

    let sel: { desktop: boolean; code: boolean } | undefined;
    while (!sel) {
      const parsed = parseTargetSelection(
        await io.prompt("번호를 입력하세요 (여러 개는 쉼표, 예: 1,2 / 빈 입력이면 종료): ", {
          mask: false,
        }),
      );
      if (parsed.ok) sel = parsed;
      else say("1 또는 2만 입력하세요.");
    }
    if (!sel.desktop && !sel.code) {
      say("선택한 대상이 없어 아무것도 기록하지 않았습니다.");
      return 0;
    }

    const results: { label: string; status: DesktopStatus | ClaudeCodeStatus }[] = [];
    let desktopStatus: DesktopStatus | undefined;
    if (sel.desktop) {
      desktopStatus = await writeDesktop(fs, desktopPath, entry, say, warn);
      results.push({ label: "Claude Desktop", status: desktopStatus });
    }
    if (sel.code) {
      const codeStatus = await registerClaudeCode(io, entry, codeFound, say, warn);
      results.push({ label: "Claude Code", status: codeStatus });
    }

    say("\n결과 요약:");
    for (const r of results) say(`- ${r.label}: ${r.status}`);
    if (desktopStatus !== undefined && desktopStatus !== "실패") say(RESTART_NOTICE);
    if (sel.code) say(ARGS_NOTICE);

    return results.some((r) => r.status === "실패") ? 1 : 0;
  } catch (e) {
    if (e instanceof SetupAbortError) {
      say("\n중단했습니다. 아무것도 기록하지 않았습니다.");
      return 130;
    }
    warn(`설정 중 오류: ${errorMessage(e)}`);
    return 1;
  } finally {
    io.close();
  }
}
