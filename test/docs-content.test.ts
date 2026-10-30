import { readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { KEY_ENV } from "../src/core/config.js";
import { allTools } from "../src/tools/registry.js";
import { listDocMarkdown } from "../scripts/docs/files.js";
import { CLIENT_PAGES, DESKTOP_APP_NAME, DOC_NOTICE, DOC_PAGES, MCPB_URL, RUN, SERVER_NAME, STATUS_BADGE, STATUS_LEGEND } from "../scripts/docs/links.js";
import { findLeaks } from "../scripts/lib/sample-mask.js";
import { codeBlocks, extractLinks, headings } from "./helpers/markdown.js";
import {
  CLIENT_LIST_LINE,
  blankLines,
  brandExclusiveProblems,
  brandProblems,
  firstBlockquote,
  firstCellTools,
  firstLineAfterNotice,
  indexListLines,
  level2Sections,
  mcpbDocProblems,
  missingTokens,
  proseText,
  startDocProblems,
  statusProblems,
  statusTables,
  tableRows,
} from "./helpers/docs-checklist.js";
import { docsDirViolations } from "./helpers/root-docs.js";
import { OFFICIAL_CLAIM_OUTPUT, matchedPatterns } from "./helpers/wording.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (rel: string): string => readFileSync(join(root, rel), "utf8");
const docFiles = listDocMarkdown(root);
const mainDocs = docFiles.filter((f) => !f.startsWith("docs/clients/"));
const clientsPath = DOC_PAGES.find((p) => p.id === "clients")?.path ?? "";
const pageDocs = docFiles.filter((f) => DOC_PAGES.some((p) => p.path === f));
const clientAppDocs = CLIENT_PAGES.map((p) => p.path);
const runLine = [RUN.command, ...RUN.args].join(" ");

// M35 착수 시 README 5개 구획(14–33, 59–67, 69–86, 88–96, 98–146)의 URL·인라인 코드 전부
const MOVED_TOKENS: readonly string[] = [
  "https://www.data.go.kr",
  "https://www.data.go.kr/data/15000736/openapi.do",
  "https://www.data.go.kr/data/15113968/openapi.do",
  "https://www.data.go.kr/data/15059486/openapi.do",
  "https://www.data.go.kr/data/15012690/openapi.do",
  "https://e-childschoolinfo.moe.go.kr",
  "https://open.law.go.kr",
  "https://www.safetykorea.kr/release/openapi",
  "get_timeline",
  "find_daycare",
  "find_vaccination_clinic",
  "find_checkup_clinic",
  "*",
  "***",
  ".bak",
  "claude mcp add --scope user",
  "claude",
  "<…>",
  "~/Library/Application Support/Claude/claude_desktop_config.json",
  "%APPDATA%\\Claude\\claude_desktop_config.json",
  "~/.config/Claude/claude_desktop_config.json",
  ".mcpb",
  "npm ci",
  "npm run pack:mcpb",
  "build-mcpb/korean-parenting-mcp.mcpb",
  "find_night_pediatric",
  "find_benefits",
  "check_pregnancy_drug",
  "find_kindergarten",
  "get_leave_article",
  "check_recall",
  "DATA_GO_KR_SERVICE_KEY",
  "KINDERGARTEN_API_KEY",
  "LAW_OC",
  "SAFETYKOREA_AUTH_KEY",
  "AuthKey",
  // README:79 and the README:62/72 fences hold the same values
  SERVER_NAME,
  runLine,
  `${runLine} setup`,
];

const MOVED_PHRASES: Record<string, readonly string[]> = {
  "docs/install.md": ["Node.js 20.19", "STDIO", "API 키 없이 바로 실행"],
  "docs/setup-wizard.md": [
    "대화형 터미널에서만",
    "Enter로 건너뛸",
    "앞 4자와 길이",
    "0600",
    "프로세스 목록",
    "Linux 경로는 미검증",
    "네트워크 호출을 하지 않습니다",
  ],
  "docs/mcpb.md": ["모두 선택 사항", "민감 정보로 저장", "수동 점검 단계"],
  "docs/advanced.md": [
    "Decoding",
    "Encoding",
    "활용신청",
    "15000736",
    "15113968",
    "15059486",
    "15012690",
    "운영계정",
    "SNS 계정",
    "담당자 승인",
    "법령·행정규칙·별표서식",
    "IP",
    "사용자 정보 검증에 실패",
    "@ 앞부분",
    "safetykorea@korea.kr",
    "양도할 수 없습니다",
    "저장소나 채팅에 적지 마세요",
    STATUS_BADGE.verified + "(목록 조회만, 상세 조회 미확인)",
  ],
  "docs/keyless.md": ["2026년 3월 15일에 출산했어", "2027년 2월 10일", "육아휴직 기간", "공휴일을 실시간으로 확인", "외부 호출이 없습니다"],
};

const CHANGED: { file: string; from: string; to: string; why: string }[] = [
  { file: "docs/setup-wizard.md", from: "소유자 전용 0600", to: "소유자만 읽고 쓸 수 있게(0600)", why: "R9 strict 중립" },
  { file: "docs/advanced.md", from: "(ii) 키 승인 대기 — 모의 응답으로만 검증", to: STATUS_BADGE.verified, why: "R11·tool-status 2026-10-30" },
  { file: "docs/keyless.md", from: "(iii)", to: STATUS_BADGE.link, why: "R11 배지" },
  { file: "docs/mcpb.md", from: "Claude Desktop에서 이 파일을 열어 설치합니다", to: DESKTOP_APP_NAME + "에서 이 파일을 열어 설치합니다", why: "R10 앱 이름" },
];

const PENDING_TOOLS: string[] = []; // tool-status 2026-10-30, (ii) 도구 없음

const statusCell = (md: string, tool: string): string => {
  const rows = tableRows(md);
  const col = rows.find((r) => r.includes("상태"))?.indexOf("상태") ?? -1;
  return rows.find((r) => r[0] === "`" + tool + "`")?.[col] ?? "";
};

describe("public docs content (M35)", () => {
  it("DOC_PAGES and CLIENT_PAGES docs exist, docs/ holds .md only (R1, M36)", () => {
    expect([...docFiles].sort()).toEqual([...DOC_PAGES.map((p) => p.path), ...CLIENT_PAGES.map((p) => p.path)].sort());
    expect(docsDirViolations(root)).toEqual([]);
    for (const f of docFiles) {
      const hangul = read(f).match(/[가-힣]/g) ?? [];
      expect(hangul.length, f).toBeGreaterThanOrEqual(30);
    }
  });

  it("each doc opens with its DOC_PAGES title and DOC_NOTICE (R2)", () => {
    for (const f of pageDocs) {
      const md = read(f);
      const page = DOC_PAGES.find((p) => p.path === f);
      expect(page, f).toBeDefined();
      expect(md.split(/\r?\n/)[0], f).toBe("# " + (page?.title ?? ""));
    }
    for (const f of docFiles) {
      const md = read(f);
      const bq = firstBlockquote(md);
      expect(bq?.text, f).toBe(DOC_NOTICE);
      const h2 = headings(md).find((h) => h.level === 2);
      if (h2) expect(bq?.line ?? Number.NaN, f).toBeLessThan(h2.line);
    }
  });

  it("no official claims, key-like strings, .docs links or underscore names (R2, R7, R12)", () => {
    for (const f of docFiles) {
      const md = read(f);
      expect(matchedPatterns(md, OFFICIAL_CLAIM_OUTPUT), f).toEqual([]);
      expect(findLeaks(md, [], { heuristic: true }), f).toEqual([]);
      expect(md.includes(".docs/"), f).toBe(false);
      expect(/korean_parenting/.test(md), f).toBe(false);
    }
  });

  it("moved tokens, phrases and changed wording are present (R4, R5)", () => {
    expect(missingTokens(MOVED_TOKENS, mainDocs.map(read))).toEqual([]);
    for (const [file, phrases] of Object.entries(MOVED_PHRASES)) {
      expect(missingTokens(phrases, [read(file)]), file).toEqual([]);
    }
    for (const c of CHANGED) {
      expect(read(c.file), c.why).toContain(c.to);
      expect(read(c.file), c.why).not.toContain(c.from);
    }
  });

  it("a removed token is detected (R4 synthetic)", () => {
    const all = mainDocs.map(read).join("\n");
    expect(missingTokens(MOVED_TOKENS, [all.replaceAll("find_kindergarten", "")])).toContain("find_kindergarten");
    expect(missingTokens(["a", "b"], ["a"])).toEqual(["b"]);
  });

  it("start.md is the easy start (R6)", () => {
    const start = read("docs/start.md");
    expect(startDocProblems(start)).toEqual([]);
    expect(startDocProblems(start + "\n```\nnpx -y x\n```\n" + MCPB_URL).length).toBeGreaterThanOrEqual(3);
    expect(startDocProblems(start.replace("## 막히면", "## 기타")).length).toBeGreaterThan(0);
    expect(startDocProblems(start + "\n준비 중\n")).toContain("금지 표현: 준비 중");
  });

  it("install.md picks one (R7)", () => {
    const install = read("docs/install.md");
    const sections = level2Sections(install);
    expect(sections[0]?.text).toBe("하나만 고르세요");
    const section = sections[0]?.body ?? "";
    expect(tableRows(section).length).toBeGreaterThanOrEqual(4);
    const targets = DOC_PAGES.filter((p) => p.parent === "install").map((p) => posix.relative("docs", p.path));
    const urls = extractLinks(section).map((l) => l.url);
    for (const t of ["mcpb.md", "setup-wizard.md", "clients/README.md"]) expect(urls, t).toContain(t);
    for (const t of targets) expect(urls, t).toContain(t);
    expect(section).toContain("두 번 등록");
    expect(firstLineAfterNotice(read("docs/mcpb.md")) ?? "", "docs/mcpb.md").toContain("](install.md)");
    expect(firstLineAfterNotice(read("docs/setup-wizard.md")) ?? "", "docs/setup-wizard.md").toContain("](install.md)");
  });

  it("index starts with start and lists DOC_PAGES (R8)", () => {
    const index = read("docs/README.md");
    const start = DOC_PAGES.find((p) => p.id === "start");
    expect(firstLineAfterNotice(index)).toBe("처음이라면 → [" + (start?.title ?? "") + "](start.md)");
    const listed = index.split(/\r?\n/).filter((l) => /^\s*- /.test(l));
    const top = listed.filter((l) => !CLIENT_LIST_LINE.test(l));
    expect(top).toEqual(indexListLines(DOC_PAGES, (p) => posix.relative("docs", p.path)));
    const sub = listed.filter((l) => CLIENT_LIST_LINE.test(l));
    const prefixes = CLIENT_PAGES.filter((p) => p.required).map(
      (p) => "    - [" + p.name + "](" + posix.relative("docs", p.path) + ") — ",
    );
    expect(sub.length).toBe(prefixes.length);
    prefixes.forEach((prefix, i) => expect(sub[i]?.startsWith(prefix), prefix).toBe(true));
    const clientsLine = top.find((l) => l.includes("(clients/README.md)")) ?? "";
    const at = listed.indexOf(clientsLine);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(listed.slice(at + 1, at + 1 + sub.length)).toEqual(sub);
  });

  it("client-neutral and app naming (R9, R10)", () => {
    for (const f of mainDocs) {
      const md = read(f);
      const body = f === "docs/README.md" ? blankLines(md, (l) => CLIENT_LIST_LINE.test(l)) : md;
      expect(brandProblems(f, body), f).toEqual([]);
    }
    expect(
      brandProblems(clientsPath, blankLines(read(clientsPath), (l) => l.startsWith("|") || l.includes("ChatGPT"))),
    ).toEqual([]);
    for (const f of clientAppDocs) expect(brandExclusiveProblems(f, read(f)), f).toEqual([]);
    for (const f of docFiles) {
      if (f !== "docs/mcpb.md") expect(proseText(read(f)), f).not.toContain(".mcpb");
      expect(proseText(read(f)), f).not.toContain("Claude Desktop");
    }
    expect(read("docs/setup-wizard.md")).toContain("소유자만 읽고 쓸 수 있게(0600)");
    expect(brandProblems("docs/x.md", "Claude Desktop 전용 설치")).not.toEqual([]);
    expect(brandProblems("docs/x.md", "Cursor에서 써 보세요")).not.toEqual([]);
    expect(brandProblems("docs/x.md", "## Claude Code")).not.toEqual([]);
    expect(brandProblems("docs/start.md", "## 이게 뭔가요\n" + DESKTOP_APP_NAME)).not.toEqual([]);
    expect(brandProblems("docs/x.md", "그 밖의 AI 앱(예: VS Code, Cursor 등)")).toEqual([]);
    expect(brandProblems("docs/x.md", DESKTOP_APP_NAME + "에서 열어요")).toEqual([]);
    expect(CLIENT_LIST_LINE.test("    - [Cursor](clients/cursor.md) — 설명")).toBe(true);
    expect(brandProblems("docs/README.md", "- Cursor 추천")).not.toEqual([]);
    expect(brandExclusiveProblems("docs/clients/x.md", "Cursor 전용 설정")).not.toEqual([]);
    expect(brandExclusiveProblems("docs/clients/x.md", "Cursor 설정 파일")).toEqual([]);
  });

  it("mcpb.md download section is the single source (M38 R8–R11)", () => {
    const md = read("docs/mcpb.md");
    expect(mcpbDocProblems(md)).toEqual([]);
    const samples = [
      md.replace("## 내려받아 설치하기", "## 내려받기"),
      md.replaceAll(MCPB_URL, "https://example.com/x"),
      md.replaceAll("Pre-release", ""),
      md + "\n준비 중입니다.\n",
      md.replace("## 개발자 빌드로 설치(선택)", "## 개발자 빌드로 설치"),
    ];
    for (const s of samples) expect(mcpbDocProblems(s).length).toBeGreaterThan(0);
    for (const f of docFiles) expect(read(f), f).not.toMatch(/준비\s*중/);
  });

  it("status badges and legend (R11)", () => {
    for (const f of docFiles) expect(statusProblems(read(f)), f).toEqual([]);
    const keyless = read("docs/keyless.md");
    const advanced = read("docs/advanced.md");
    expect(statusTables(keyless).length).toBeGreaterThanOrEqual(1);
    expect(statusTables(advanced).length).toBeGreaterThanOrEqual(1);
    expect(statusCell(advanced, "check_recall").startsWith(STATUS_BADGE.verified)).toBe(true);
    expect(statusCell(keyless, "get_timeline").startsWith(STATUS_BADGE.verified)).toBe(true);
    for (const t of ["find_daycare", "find_vaccination_clinic", "find_checkup_clinic"]) {
      expect(statusCell(keyless, t).startsWith(STATUS_BADGE.link), t).toBe(true);
    }
    for (const f of docFiles) {
      for (const line of read(f).split(/\r?\n/)) {
        if (!line.includes(STATUS_BADGE.pending)) continue;
        const tool = /^\|\s*`([a-z_]+)`/.exec(line)?.[1] ?? "";
        const ok = line === STATUS_LEGEND || PENDING_TOOLS.includes(tool);
        expect(ok, `${f}: ${line}`).toBe(true);
      }
    }
    const joined = docFiles.map((f) => read(f).split(/\r?\n/).filter((l) => l !== STATUS_LEGEND).join("\n")).join("\n");
    expect(joined).not.toMatch(/승인\s*대기|모킹|모의\s*응답|fixture/i);
    expect(statusProblems("| 도구 | 상태 |\n| --- | --- |\n| x | (ii) y |\n")).not.toEqual([]);
    expect(statusProblems(`| 도구 | 상태 |\n| --- | --- |\n| x | ${STATUS_BADGE.verified} |\n`)).not.toEqual([]);
  });

  it("advanced/keyless tables equal registry (R12)", () => {
    const keyed = allTools.filter((t) => t.requiredKeys?.length);
    const keyless = allTools.filter((t) => !t.requiredKeys?.length);
    const advanced = read("docs/advanced.md");
    const keylessDoc = read("docs/keyless.md");

    const advNames = firstCellTools(advanced);
    expect([...advNames].sort()).toEqual(keyed.map((t) => t.name).sort());
    expect(new Set(advNames).size).toBe(advNames.length);

    const advRows = tableRows(advanced);
    const foundEnv = new Set<string>();
    for (const t of keyed) {
      const row = advRows.find((r) => r[0] === "`" + t.name + "`");
      expect(row, t.name).toBeDefined();
      const expectedKeys = t.requiredKeys!.map((k) => "`" + KEY_ENV[k] + "`").join(", ");
      expect(row?.[2], t.name).toBe(expectedKeys);
      for (const m of (row?.[2] ?? "").matchAll(/`([A-Z_]+)`/g)) foundEnv.add(m[1] ?? "");
    }
    expect([...foundEnv].sort()).toEqual([...new Set(Object.values(KEY_ENV))].sort());

    const keylessNames = firstCellTools(keylessDoc);
    expect([...keylessNames].sort()).toEqual(keyless.map((t) => t.name).sort());
    expect(keylessNames[0]).toBe("get_timeline");
  });

  it("run command and server name come from RUN and SERVER_NAME (R13)", () => {
    for (const f of docFiles) {
      for (const block of codeBlocks(read(f))) {
        if (block.lang !== "bash" && block.lang !== "sh") continue;
        for (const raw of block.body.split("\n")) {
          const t = raw.trim();
          if (t.startsWith("npx ")) expect(t.startsWith(runLine), f).toBe(true);
        }
      }
    }
    const install = codeBlocks(read("docs/install.md"));
    expect(install.some((b) => b.lang === "bash" && b.body.trim() === runLine)).toBe(true);
    const wizard = read("docs/setup-wizard.md");
    const wizardBlocks = codeBlocks(wizard);
    expect(wizardBlocks.some((b) => b.lang === "bash" && b.body.trim() === runLine + " setup")).toBe(true);
    expect(wizard).toContain("`" + SERVER_NAME + "`");
    expect(wizard).toContain("중복");
    expect(wizard).toContain("한 방법만");
  });
});
