import { readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { describe, expect, it } from "vitest";
import { KEY_ENV } from "../src/core/config.js";
import { listDocMarkdown } from "../scripts/docs/files.js";
import {
  CLIENT_PAGES,
  DESKTOP_APP_NAME,
  DOC_NOTICE,
  DOC_PAGES,
  RUN,
  SERVER_NAME,
  type ClientFormat,
  type ClientPage,
} from "../scripts/docs/links.js";
import { codeBlocks, extractLinks } from "./helpers/markdown.js";
import {
  firstLineAfterNotice,
  level2Sections,
  proseLines,
  tableRows,
} from "./helpers/docs-checklist.js";
import { parseMiniToml, type TomlTable } from "./helpers/mini-toml.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (rel: string): string => readFileSync(join(root, rel), "utf8");

const SECTIONS: readonly string[] = ["설정 위치", "설정 예시(키 없이)", "설정 예시(선택 키 포함)", "적용하기", "연결 확인", "근거"];
const KEYLESS = "설정 예시(키 없이)";
const KEYED = "설정 예시(선택 키 포함)";
const KEY_NAMES = new Set<string>(Object.values(KEY_ENV));
const PLACEHOLDER = /^<[^>]+>$/;
const ENV_REF = /^\$\{env:([A-Z_]+)\}$/;
const runLine = [RUN.command, ...RUN.args].join(" ");
const FENCE_LANG: Record<ClientFormat, string> = { json: "json", toml: "toml", cli: "sh" };
const LABEL = /확인 수준|미검증/;
const CAUTION = "아직 직접 확인하지 못했어요";

type Mode = "none" | "keys" | "any";

interface Entry {
  hasType: boolean;
  type: unknown;
  command: unknown;
  args: unknown;
  env: unknown;
  envVars: unknown;
  envPairs: [string, string][];
}

function pageOf(id: string): ClientPage {
  const p = CLIENT_PAGES.find((c) => c.id === id);
  if (!p) throw new Error(`no client page ${id}`);
  return p;
}

function unquote(token: string): string {
  return /^(["']).*\1$/.test(token) ? token.slice(1, -1) : token;
}

function objEntry(obj: Record<string, unknown>): Entry {
  return {
    hasType: "type" in obj,
    type: obj.type,
    command: obj.command,
    args: obj.args,
    env: obj.env,
    envVars: undefined,
    envPairs: [],
  };
}

function jsonEntries(page: ClientPage, body: string): Entry[] {
  const doc = JSON.parse(body) as Record<string, unknown>;
  if (page.wrapper === null) throw new Error("wrapper 없음");
  const servers = doc[page.wrapper];
  if (typeof servers !== "object" || servers === null || Array.isArray(servers)) throw new Error("wrapper 없음");
  if (!isDeepStrictEqual(Object.keys(servers), [SERVER_NAME])) throw new Error("server key");
  const entry = (servers as Record<string, unknown>)[SERVER_NAME];
  if (typeof entry !== "object" || entry === null) throw new Error("server key");
  return [objEntry(entry as Record<string, unknown>)];
}

function tomlEntries(body: string): Entry[] {
  const doc = parseMiniToml(body);
  const servers = doc.mcp_servers;
  if (servers === undefined || typeof servers === "string" || Array.isArray(servers)) throw new Error("mcp_servers 없음");
  if (!isDeepStrictEqual(Object.keys(servers), [SERVER_NAME])) throw new Error("server key");
  const entry = servers[SERVER_NAME];
  if (entry === undefined || typeof entry === "string" || Array.isArray(entry)) throw new Error("server key");
  const table: TomlTable = entry;
  return [
    {
      hasType: "type" in table,
      type: table.type,
      command: table.command,
      args: table.args,
      env: table.env,
      envVars: table.env_vars,
      envPairs: [],
    },
  ];
}

function shEntries(body: string): Entry[] {
  const out: Entry[] = [];
  const runTokens = [RUN.command, ...RUN.args];
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    if (line.includes("--add-mcp")) {
      const json = /'([^']*)'/.exec(line)?.[1];
      if (json === undefined) throw new Error("--add-mcp 인자 없음");
      const parsed = JSON.parse(json) as Record<string, unknown>;
      if (parsed.name !== SERVER_NAME) throw new Error("server key");
      out.push(objEntry(parsed));
      continue;
    }
    const tokens = (line.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map(unquote);
    const mcpIdx = tokens.indexOf("mcp");
    if (mcpIdx < 0 || tokens[mcpIdx + 1] !== "add") continue;
    if (!line.endsWith(` ${runLine}`)) throw new Error("실행 명령이 줄 끝에 없음");
    const envPairs: [string, string][] = [];
    const envSlots = new Set<number>();
    tokens.forEach((t, i) => {
      if (t !== "--env" && t !== "-e") return;
      const pair = tokens[i + 1] ?? "";
      const eq = pair.indexOf("=");
      if (eq < 0) throw new Error("env 형식 오류");
      envPairs.push([pair.slice(0, eq), pair.slice(eq + 1)]);
      envSlots.add(i);
      envSlots.add(i + 1);
    });
    const runStart = tokens.length - runTokens.length;
    const nameTokens = tokens.filter((_, i) => !envSlots.has(i));
    const keptRunStart = nameTokens.length - runTokens.length;
    const dashIdx = nameTokens[keptRunStart - 1] === "--" ? keptRunStart - 1 : keptRunStart;
    if (nameTokens[dashIdx - 1] !== SERVER_NAME) throw new Error("server key");
    out.push({
      hasType: false,
      type: undefined,
      command: tokens[runStart],
      args: tokens.slice(runStart + 1),
      env: undefined,
      envVars: undefined,
      envPairs,
    });
  }
  return out;
}

function entriesOf(page: ClientPage, lang: string, body: string): Entry[] {
  if (lang === "json") return jsonEntries(page, body);
  if (lang === "toml") return tomlEntries(body);
  if (lang === "sh") return shEntries(body);
  throw new Error(`언어 ${lang}`);
}

function valueOk(page: ClientPage, value: string): boolean {
  if (PLACEHOLDER.test(value)) return true;
  const ref = ENV_REF.exec(value);
  return page.id === "cursor" && ref !== null && KEY_NAMES.has(ref[1] ?? "");
}

function entryProblems(page: ClientPage, e: Entry, mode: Mode): string[] {
  const out: string[] = [];
  if (e.command !== RUN.command || !isDeepStrictEqual(e.args, [...RUN.args])) out.push("실행 명령 불일치");
  if (page.typeField === "stdio" && e.type !== "stdio") out.push('type은 "stdio"여야 해요');
  if (page.typeField === "forbidden" && e.hasType) out.push("type 필드는 쓰지 않아요");
  if (page.typeField === "any" && e.hasType && e.type !== "stdio") out.push('type은 "stdio"만 허용');

  const pairs: [string, string | null][] = [];
  if (e.env !== undefined) {
    if (typeof e.env !== "object" || e.env === null || Array.isArray(e.env)) out.push("env 형식 오류");
    else for (const [k, v] of Object.entries(e.env as Record<string, unknown>)) pairs.push([k, String(v)]);
  }
  if (e.envVars !== undefined) {
    if (page.format !== "toml") out.push("env_vars는 toml에서만 허용");
    else if (!Array.isArray(e.envVars)) out.push("env_vars 형식 오류");
    else for (const k of e.envVars) pairs.push([String(k), null]);
  }
  for (const [k, v] of e.envPairs) pairs.push([k, v]);

  if (mode === "none" && (e.env !== undefined || e.envVars !== undefined || pairs.length > 0)) {
    out.push("키 없이 예시에 env가 있어요");
  }
  if (mode === "keys" && pairs.length === 0) out.push("키 없음");
  for (const [k, v] of pairs) {
    if (!KEY_NAMES.has(k)) out.push(`허용되지 않은 키 이름: ${k}`);
    if (v !== null && !valueOk(page, v)) out.push(`키 값 형식 오류: ${k}`);
  }
  return out;
}

function modeOf(section: string | undefined): Mode {
  if (section === KEYLESS) return "none";
  if (section === KEYED) return "keys";
  return "any";
}

function sectionAt(sections: ReturnType<typeof level2Sections>, line: number): string | undefined {
  return sections.filter((s) => s.line <= line).at(-1)?.text;
}

function pageProblems(page: ClientPage, md: string): string[] {
  const problems: string[] = [];
  const lines = md.split(/\r?\n/);
  const title = lines[0] ?? "";
  if (!title.startsWith("# ") || !title.includes(page.name)) problems.push("제목 불일치");

  const sections = level2Sections(md);
  if (!isDeepStrictEqual(sections.map((s) => s.text), [...SECTIONS])) problems.push("섹션 목록 불일치");

  const last = sections.at(-1);
  if (!last?.body.includes("https://")) problems.push("마지막 구획에 공식 문서 링크 없음");
  if (lines.some((l) => LABEL.test(l))) problems.push("확인 수준·미검증 표기 금지");

  const first = firstLineAfterNotice(md) ?? "";
  if (!first.includes("](../install.md)") && !first.includes("](README.md)")) problems.push("뒤로 링크 없음");
  if (!extractLinks(md).some((l) => l.url === "../install.md")) problems.push("../install.md 링크 없음");

  if (!lines.some((l) => /두 번 등록/.test(l))) problems.push("중복 등록 안내 없음");

  const parsed: { lang: string; sec: string | undefined; entries: Entry[] }[] = [];
  for (const b of codeBlocks(md)) {
    if (!["json", "toml", "sh"].includes(b.lang)) {
      problems.push(`코드 블록 ${b.line}행: 언어 ${b.lang}`);
      continue;
    }
    const sec = sectionAt(sections, b.line);
    let entries: Entry[];
    try {
      entries = entriesOf(page, b.lang, b.body);
    } catch (err) {
      problems.push(`블록 ${b.line}행: ${(err as Error).message}`);
      continue;
    }
    const mode = modeOf(sec);
    for (const e of entries) {
      for (const p of entryProblems(page, e, mode)) problems.push(`블록 ${b.line}행: ${p}`);
    }
    parsed.push({ lang: b.lang, sec, entries });
  }
  for (const name of [KEYLESS, KEYED]) {
    if (!parsed.some((p) => p.sec === name && p.lang === FENCE_LANG[page.format] && p.entries.length > 0)) {
      problems.push(`${name}: 예시 블록 없음`);
    }
  }

  const connection = sections.find((s) => s.text === "연결 확인")?.body ?? "";
  if (!connection.includes("get_timeline") && !connection.includes("도구 목록")) problems.push("연결 확인 문구 없음");

  for (const { line, text } of proseLines(md)) {
    if (text.includes("ChatGPT") && !text.includes("원격")) problems.push(`${line}행: ChatGPT 줄에 원격 문구 없음`);
  }
  for (const b of codeBlocks(md)) {
    if (b.body.includes("ChatGPT")) problems.push(`코드 블록 ${b.line}행에 ChatGPT`);
  }

  lines.forEach((l, i) => {
    if (/(직접|실제로)\s*(연결|설치)해\s*(확인했|봤|보았)/.test(l)) problems.push(`${i + 1}행: 실제 연결 확인 주장`);
  });

  if (page.id === "claude-desktop") {
    if (page.name !== DESKTOP_APP_NAME) problems.push("앱 이름 불일치");
    if (!title.includes(DESKTOP_APP_NAME)) problems.push("제목에 앱 이름 없음");
    const headEnd = lines.findIndex((l) => l.startsWith("## "));
    const head = lines.slice(0, headEnd < 0 ? lines.length : headEnd).join("\n");
    const urls = extractLinks(head).map((l) => l.url);
    for (const u of ["../mcpb.md", "../setup-wizard.md"]) {
      if (!urls.includes(u)) problems.push(`${u} 링크 없음`);
    }
    if (!lines.some((l) => l.includes("Linux") && l.includes(CAUTION))) problems.push("Linux 주의 문장 없음");
  }
  return problems;
}

function clientsIndexProblems(md: string): string[] {
  const out: string[] = [];
  const lines = md.split(/\r?\n/);
  const first = firstLineAfterNotice(md) ?? "";
  if (!first.includes("](../install.md)")) out.push("뒤로 링크 없음");
  const idx = lines.findIndex((l) => l.trim() === first);
  const after = lines.slice(idx + 1).find((l) => l.trim() !== "") ?? "";
  if (!after.includes("](../mcpb.md)") || !after.includes(DESKTOP_APP_NAME)) out.push("데스크톱 안내 줄 없음");

  const rows = tableRows(md);
  if (!isDeepStrictEqual(rows[0], ["앱", "설정 위치", "형식", "문서"])) out.push("표 머리글 불일치");
  for (const p of CLIENT_PAGES) {
    const rel = posix.relative("docs/clients", p.path);
    const row = rows.find((r) => extractLinks(r[3] ?? "").some((l) => l.url === rel));
    if (!row) {
      out.push(`표에 ${p.id} 행 없음`);
      continue;
    }
    if (row[0] !== p.name) out.push(`앱 이름 불일치: ${p.id}`);
  }

  const last = lines.filter((l) => l.trim() !== "").at(-1) ?? "";
  if (!last.includes("ChatGPT") || !last.includes("원격")) out.push("마지막 줄 ChatGPT·원격 문구 없음");
  if (md.includes("확인 수준")) out.push("확인 수준 표기 금지");
  return out;
}

const OTHERS: readonly { heading: string; wrapper: string | null }[] = [
  { heading: "Windsurf", wrapper: "mcpServers" },
  { heading: "Zed", wrapper: "context_servers" },
  { heading: "JetBrains AI Assistant", wrapper: null },
];
const OTHERS_CAUTION = CAUTION + ". ";

function othersProblems(md: string): string[] {
  const out: string[] = [];
  const lines = md.split(/\r?\n/);
  const title = lines[0] ?? "";
  if (!title.startsWith("# ") || !title.includes(pageOf("others").name)) out.push("제목 불일치");
  const first = firstLineAfterNotice(md) ?? "";
  if (!first.includes("](../install.md)")) out.push("뒤로 링크 없음");
  if (!lines.some((l) => /두 번 등록/.test(l))) out.push("중복 등록 안내 없음");

  const sections = level2Sections(md);
  if (!isDeepStrictEqual(sections.map((s) => s.text), [...OTHERS.map((o) => o.heading), "연결 확인"])) out.push("섹션 목록 불일치");
  if (lines.some((l) => LABEL.test(l))) out.push("확인 수준·미검증 표기 금지");

  for (const o of OTHERS) {
    const body = sections.find((s) => s.text === o.heading)?.body ?? "";
    const bodyLines = body.split(/\r?\n/);
    const cautions = bodyLines.filter((l) => l.startsWith(OTHERS_CAUTION));
    if (cautions.length !== 1 || (cautions[0] ?? "").slice(OTHERS_CAUTION.length).length < 10) out.push(`${o.heading}: 주의 문장 오류`);
    if (!body.includes("https://")) out.push(`${o.heading}: 출처 링크 없음`);
    const blocks = codeBlocks(body);
    if (blocks.length !== 1 || blocks[0]?.lang !== "json") {
      out.push(`${o.heading}: 코드 블록 오류`);
      continue;
    }
    try {
      const doc = JSON.parse(blocks[0]?.body ?? "") as Record<string, unknown>;
      let entry: unknown = doc;
      if (o.wrapper !== null) {
        if (!isDeepStrictEqual(Object.keys(doc), [o.wrapper])) throw new Error("wrapper");
        const servers = doc[o.wrapper];
        if (typeof servers !== "object" || servers === null || Array.isArray(servers)) throw new Error("wrapper");
        if (!isDeepStrictEqual(Object.keys(servers), [SERVER_NAME])) throw new Error("server key");
        entry = (servers as Record<string, unknown>)[SERVER_NAME];
      }
      if (typeof entry !== "object" || entry === null) throw new Error("entry");
      const e = entry as Record<string, unknown>;
      if (!Object.keys(e).every((k) => k === "command" || k === "args")) out.push(`${o.heading}: 허용되지 않은 항목`);
      if (e.command !== RUN.command) out.push(`${o.heading}: 실행 명령 불일치`);
      if (!isDeepStrictEqual(e.args, [...RUN.args])) out.push(`${o.heading}: 실행 인자 불일치`);
    } catch {
      out.push(`${o.heading}: JSON 해석 오류`);
    }
  }

  const connection = sections.find((s) => s.text === "연결 확인")?.body ?? "";
  if (!connection.includes("get_timeline")) out.push("연결 확인 문구 없음");
  lines.forEach((l, i) => {
    if (/(직접|실제로)\s*(연결|설치)해\s*(확인했|봤|보았)/.test(l)) out.push(`${i + 1}행: 실제 연결 확인 주장`);
  });

  const bodyOf = (heading: string): string => sections.find((s) => s.text === heading)?.body ?? "";
  const windsurf = bodyOf("Windsurf");
  if (!windsurf.includes("~/.codeium/windsurf/mcp_config.json") || !windsurf.split(/\r?\n/).some((l) => l.includes("다른 사람이 쓴"))) {
    out.push("Windsurf 출처 문구 없음");
  }
  if (!bodyOf("Zed").includes("context_servers")) out.push("Zed 설정 키 문구 없음");
  if (!bodyOf("JetBrains AI Assistant").includes("Model Context Protocol (MCP)")) out.push("JetBrains 메뉴 문구 없음");
  return out;
}

function exampleBody(page: ClientPage, withKey: boolean): string {
  if (page.format === "json") {
    if (page.wrapper === null) throw new Error("wrapper 없음");
    const entry = {
      ...(page.typeField === "stdio" ? { type: "stdio" } : {}),
      command: RUN.command,
      args: [...RUN.args],
      ...(withKey ? { env: { DATA_GO_KR_SERVICE_KEY: "<발급받은 키>" } } : {}),
    };
    return JSON.stringify({ [page.wrapper]: { [SERVER_NAME]: entry } }, null, 2);
  }
  if (page.format === "toml") {
    const lines = [`[mcp_servers.${SERVER_NAME}]`, `command = "${RUN.command}"`, `args = ["${RUN.args[0]}", "${RUN.args[1]}"]`];
    if (withKey) lines.push("", `[mcp_servers.${SERVER_NAME}.env]`, `DATA_GO_KR_SERVICE_KEY = "<발급받은 키>"`);
    return lines.join("\n");
  }
  const env = withKey ? ` --env "DATA_GO_KR_SERVICE_KEY=<발급받은 키>"` : "";
  return `claude mcp add --transport stdio --scope user${env} ${SERVER_NAME} -- ${runLine}`;
}

function docWith(page: ClientPage, keyless: string, keyed: string): string {
  const fence = FENCE_LANG[page.format];
  const block = (body: string): string => "```" + fence + "\n" + body + "\n```";
  const isDesktop = page.id === "claude-desktop";
  const desktopLinks = isDesktop ? " · [파일 하나로 설치하기](../mcpb.md) · [설정 마법사로 설치하기](../setup-wizard.md)" : "";
  const linuxLine = isDesktop ? "\n\nLinux에서는 경로를 아직 직접 확인하지 못했어요." : "";
  return [
    `# ${page.name}에 연결하기`,
    "",
    `> ${DOC_NOTICE}`,
    "",
    `[← 설치 방법 고르기](../install.md) · [AI 앱 목록](README.md)${desktopLinks}`,
    "",
    "이미 다른 방법으로 등록했다면 다시 추가하지 마세요. 같은 서버가 두 번 등록될 수 있어요.",
    "",
    "## 설정 위치",
    "",
    `설정 위치 안내.${linuxLine}`,
    "",
    `## ${KEYLESS}`,
    "",
    block(keyless),
    "",
    `## ${KEYED}`,
    "",
    block(keyed),
    "",
    "## 적용하기",
    "",
    "앱을 다시 시작하세요.",
    "",
    "## 연결 확인",
    "",
    "AI에게 물어보세요. `get_timeline` 도구가 불리면 연결된 거예요.",
    "",
    "## 근거",
    "",
    "아래 공식 문서를 읽고 정리한 내용이에요.",
    "",
    "<https://example.com/x>",
    "",
  ].join("\n");
}

function goodDoc(page: ClientPage): string {
  return docWith(page, exampleBody(page, false), exampleBody(page, true));
}

function swapSections(md: string): string {
  const parts = md.split("\n## ");
  const first = parts[1] ?? "";
  parts[1] = parts[2] ?? "";
  parts[2] = first;
  return parts.join("\n## ");
}

describe("client docs (M36)", () => {
  it("CLIENT_PAGES required pages exist with fixed sections (R2, R4, R8)", () => {
    for (const p of CLIENT_PAGES.filter((c) => c.required)) {
      expect(pageProblems(p, read(p.path)), p.id).toEqual([]);
    }
    expect(listDocMarkdown(root).filter((f) => /chatgpt/i.test(f))).toEqual([]);
  });

  it("location facts per app (R5, R10)", () => {
    const facts: [string, string[], string[]][] = [
      ["vscode", ["MCP: Open User Configuration"], []],
      ["cursor", ["~/.cursor/mcp.json"], []],
      ["gemini", ["~/.gemini/settings.json", "Reload Window"], []],
      ["antigravity", ["~/.gemini/config/mcp_config.json"], ["~/.gemini/antigravity/"]],
      ["codex", ["~/.codex/config.toml"], []],
      [
        "claude-desktop",
        ["~/Library/Application Support/Claude/claude_desktop_config.json", "%APPDATA%\\Claude\\claude_desktop_config.json"],
        ["~/.config/Claude"],
      ],
    ];
    for (const [id, must, mustNot] of facts) {
      const md = read(pageOf(id).path);
      for (const s of must) expect(md, `${id}: ${s}`).toContain(s);
      for (const s of mustNot) expect(md, `${id}: ${s}`).not.toContain(s);
    }
  });

  it("clients README links all pages (R3, R8)", () => {
    const clientsPath = DOC_PAGES.find((p) => p.id === "clients")?.path ?? "";
    expect(clientsIndexProblems(read(clientsPath))).toEqual([]);
  });

  it("ChatGPT lines mention 원격 across docs (R9)", () => {
    for (const f of listDocMarkdown(root)) {
      const bad = proseLines(read(f))
        .filter((l) => l.text.includes("ChatGPT") && !l.text.includes("원격"))
        .map((l) => `${f}:${l.line}`);
      expect(bad, f).toEqual([]);
    }
  });

  it("synthetic good samples pass", () => {
    for (const p of CLIENT_PAGES.filter((c) => c.required)) {
      expect(pageProblems(p, goodDoc(p)), p.id).toEqual([]);
    }
  });

  it("synthetic violations fail (AC4, AC5)", () => {
    const vs = pageOf("vscode");
    const cu = pageOf("cursor");
    const ag = pageOf("antigravity");
    const cc = pageOf("claude-code");
    const cx = pageOf("codex");
    const dk = pageOf("claude-desktop");
    const cases: [string, ClientPage, string][] = [
      ["깨진 JSON", vs, goodDoc(vs).replace("}\n```", "\n```")],
      ["밑줄 서버 키", cu, goodDoc(cu).replaceAll(`"${SERVER_NAME}": {`, '"korean_parenting": {')],
      ["허용되지 않은 env 키", vs, goodDoc(vs).replaceAll("DATA_GO_KR_SERVICE_KEY", "API_KEY")],
      ["실제 키 값", vs, goodDoc(vs).replace("<발급받은 키>", "a1b2c3d4e5f6a1b2c3d4e5f6")],
      ["antigravity에 type 추가", ag, goodDoc(ag).replaceAll('"command": "npx"', '"type": "stdio", "command": "npx"')],
      ["vscode에서 type 제거", vs, goodDoc(vs).replaceAll(/\n\s*"type": "stdio",/g, "")],
      ["claude-code 줄 끝 npx 단독", cc, goodDoc(cc).replaceAll(`-y ${RUN.args[1]}`, RUN.args[1])],
      ["ChatGPT 줄 추가", vs, goodDoc(vs) + "\nChatGPT에서도 써요.\n"],
      ["섹션 순서 뒤바꿈", vs, swapSections(goodDoc(vs))],
      ["확인 수준 줄 추가", vs, goodDoc(vs) + "\n확인 수준: 공식 문서 근거\n"],
      ["데스크톱 Linux 주의 문장 없음", dk, goodDoc(dk).replace("Linux에서는 경로를 아직 직접 확인하지 못했어요.", "")],
      ["비 cursor 설정에 ${env:} 값", vs, goodDoc(vs).replace("<발급받은 키>", "${env:DATA_GO_KR_SERVICE_KEY}")],
      ["codex toml에 잘못된 줄", cx, goodDoc(cx).replaceAll('command = "npx"', 'command = "npx"\nx = 1')],
      ["키 없이 섹션에 env", vs, docWith(vs, exampleBody(vs, true), exampleBody(vs, true))],
      ["데스크톱 mcpb 링크 없음", dk, goodDoc(dk).replace("(../mcpb.md)", "(../other.md)")],
    ];
    for (const [name, page, doc] of cases) {
      expect(pageProblems(page, doc), name).not.toEqual([]);
    }
  });

  it("client docs carry no 확인 수준 or 미검증 label (M39 scope addition)", () => {
    for (const f of listDocMarkdown(root).filter((f) => f.startsWith("docs/clients/"))) {
      expect(read(f).split("\n").filter((l) => LABEL.test(l)), f).toEqual([]);
    }
  });

  it("mini TOML parser", () => {
    expect(parseMiniToml('[a.b]\n# c\nx = "1" # t\ny = ["p", "q"]\n[a.b.env]\nK = "<v>"\n')).toEqual({
      a: { b: { x: "1", y: ["p", "q"], env: { K: "<v>" } } },
    });
    const bad = [
      "x = 1",
      "x = true",
      'x = { a = "b" }',
      "[[a]]",
      'x = "a\\"b"',
      'a.b = "c"',
      'x = ["a",]',
      'x = "1"\nx = "2"',
      "[a]\n[a]",
    ];
    for (const src of bad) {
      expect(() => parseMiniToml(src), src).toThrow();
    }
  });

  it("clients README violations fail", () => {
    const clientsPath = DOC_PAGES.find((p) => p.id === "clients")?.path ?? "";
    const readme = read(clientsPath);
    expect(clientsIndexProblems(readme.split("\n").filter((l) => !l.startsWith("| VS Code |")).join("\n"))).not.toEqual([]);
    expect(
      clientsIndexProblems(readme.replace("| 앱 | 설정 위치 | 형식 | 문서 |", "| 앱 | 설정 위치 | 형식 | 확인 수준 | 문서 |")),
    ).not.toEqual([]);
    expect(clientsIndexProblems(readme.replace(/^ChatGPT 등[^\n]*$/m, "ChatGPT에서도 돼요"))).not.toEqual([]);
  });

  it("others page lists unverified apps (M37 AC3, AC4)", () => {
    expect(othersProblems(read(pageOf("others").path))).toEqual([]);
  });

  it("others synthetic violations fail (M37)", () => {
    const good = read(pageOf("others").path);
    const cases: [string, string][] = [
      ["확인 수준 줄 추가", good.replace("## Zed", "확인 수준: 미검증\n\n## Zed")],
      ["밑줄 서버 키", good.replaceAll(`"${SERVER_NAME}"`, '"korean_parenting"')],
      ["실행 명령 변경", good.replace('"command": "npx"', '"command": "node"')],
      ["env 추가", good.replace('"command": "npx",', '"command": "npx", "env": { "LAW_OC": "x" },')],
      ["주의 문장 제거", good.replace(/^아직 직접 확인하지 못했어요\. .*\n/m, "")],
    ];
    for (const [name, doc] of cases) {
      expect(othersProblems(doc), name).not.toEqual([]);
    }
  });
});
