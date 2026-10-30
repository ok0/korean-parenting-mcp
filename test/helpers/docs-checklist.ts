import { posix } from "node:path";
import { DESKTOP_APP_NAME, DOC_PAGES, MCPB_URL, STATUS_BADGE, STATUS_LEGEND, type DocPage } from "../../scripts/docs/links.js";
import { extractLinks, headings } from "./markdown.js";
import { CLIENT_BRANDS } from "./visuals.js";

const SETUP_TARGET_NAME = "Claude Code";
export const SETUP_TARGET_FILES: readonly string[] = ["docs/setup-wizard.md", "docs/install.md"];

export const START_SECTIONS: readonly string[] = [
  "이게 뭔가요",
  "무엇이 필요한가요",
  "설치 방법 하나 고르기",
  "가장 쉬운 길: " + DESKTOP_APP_NAME,
  "첫 질문 해 보기",
  "막히면",
];

function isFence(line: string): boolean {
  return /^\s*(```|~~~)/.test(line);
}

export function firstBlockquote(md: string): { text: string; line: number } | null {
  const lines = md.split(/\r?\n/);
  let inFence = false;
  let start = -1;
  const quoted: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    if (isFence(raw)) {
      inFence = !inFence;
      if (start >= 0) break;
      continue;
    }
    if (inFence) continue;
    if (/^>\s?/.test(raw)) {
      if (start < 0) start = i;
      quoted.push(raw.replace(/^>\s?/, ""));
    } else if (start >= 0) {
      break;
    }
  }
  if (start < 0) return null;
  return { text: quoted.join(" ").trim(), line: start + 1 };
}

export function firstLineAfterNotice(md: string): string | undefined {
  let inFence = false;
  let state: 0 | 1 | 2 = 0;
  for (const raw of md.split(/\r?\n/)) {
    if (isFence(raw)) inFence = !inFence;
    if (state === 0) {
      if (!inFence && /^>\s?/.test(raw)) state = 1;
      continue;
    }
    if (state === 1) {
      if (!inFence && /^>\s?/.test(raw)) continue;
      state = 2;
    }
    if (raw.trim() !== "") return raw.trim();
  }
  return undefined;
}

const SEPARATOR = /^\|(\s*:?-{3,}:?\s*\|)+\s*$/;
const TABLE_LINE = /^\|.*\|\s*$/;

function splitRow(line: string): string[] {
  return line.split("|").slice(1, -1).map((c) => c.trim());
}

export function tableRows(md: string): string[][] {
  const out: string[][] = [];
  for (const raw of md.split(/\r?\n/)) {
    if (!TABLE_LINE.test(raw)) continue;
    if (SEPARATOR.test(raw)) continue;
    out.push(splitRow(raw));
  }
  return out;
}

export function firstCellTools(md: string): string[] {
  const names: string[] = [];
  for (const cells of tableRows(md)) {
    const m = /^`([a-z_]+)`$/.exec(cells[0] ?? "");
    if (m) names.push(m[1] ?? "");
  }
  return names;
}

export function missingTokens(tokens: readonly string[], texts: readonly string[]): string[] {
  return tokens.filter((t) => !texts.some((x) => x.includes(t)));
}

export function proseLines(md: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  let inFence = false;
  md.split(/\r?\n/).forEach((raw, i) => {
    if (isFence(raw)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const text = raw
      .replace(/`[^`]*`/g, "")
      .replace(/\]\([^)]*\)/g, "]")
      .replace(/https?:\/\/\S+/g, "");
    out.push({ line: i + 1, text });
  });
  return out;
}

export function proseText(md: string): string {
  return proseLines(md).map((l) => l.text).join("\n");
}

export function brandProblems(file: string, md: string): string[] {
  const problems: string[] = [];
  const isSetupFile = SETUP_TARGET_FILES.includes(file);
  for (const { line, text } of proseLines(md)) {
    const where = `${file}:${line} ${text}`;
    if (CLIENT_BRANDS.some((r) => r.test(text)) && text.includes("전용")) problems.push(where);
    let rest = text.split(DESKTOP_APP_NAME).join("");
    if (isSetupFile) rest = rest.split(SETUP_TARGET_NAME).join("");
    if (CLIENT_BRANDS.some((r) => r.test(rest))) {
      if (/^#{1,6}\s/.test(text)) problems.push(where);
      else if (!text.includes("예:")) problems.push(where);
    }
  }
  if (file === "docs/start.md") {
    const raw = md.split(/\r?\n/);
    const cut = raw.findIndex((l) => l === "## 설치 방법 하나 고르기");
    const before = cut < 0 ? raw : raw.slice(0, cut);
    before.forEach((text, i) => {
      if (CLIENT_BRANDS.some((r) => r.test(text))) problems.push(`${file}:${i + 1} ${text}`);
    });
  }
  return problems;
}

export function statusTables(md: string): { line: number; cells: string[]; after: string | undefined }[] {
  const lines = md.split(/\r?\n/);
  const fenced: boolean[] = [];
  let inFence = false;
  for (const raw of lines) {
    if (isFence(raw)) {
      inFence = !inFence;
      fenced.push(true);
      continue;
    }
    fenced.push(inFence);
  }
  const out: { line: number; cells: string[]; after: string | undefined }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (fenced[i] || !TABLE_LINE.test(lines[i] ?? "")) continue;
    let end = i;
    while (end + 1 < lines.length && !fenced[end + 1] && TABLE_LINE.test(lines[end + 1] ?? "")) end++;
    const col = splitRow(lines[i] ?? "").indexOf("상태");
    if (col >= 0) {
      const cells = lines
        .slice(i + 1, end + 1)
        .filter((l) => !SEPARATOR.test(l))
        .map((l) => splitRow(l)[col] ?? "");
      const next = lines[end + 1] === "" ? end + 2 : end + 1;
      out.push({ line: i + 1, cells, after: lines[next] });
    }
    i = end;
  }
  return out;
}

export function statusProblems(md: string): string[] {
  const problems: string[] = [];
  const badges: string[] = Object.values(STATUS_BADGE);
  for (const t of statusTables(md)) {
    for (const cell of t.cells) {
      const badge = badges.find((b) => cell.startsWith(b));
      const rest = badge ? cell.slice(badge.length) : "";
      if (!badge || !/^(\([^()]{1,40}\))?$/.test(rest)) problems.push(`상태 칸 형식 오류 (${t.line}행): ${cell}`);
    }
    if (t.after !== STATUS_LEGEND) problems.push(`범례 없음 (${t.line}행 표 아래)`);
  }
  if (/\((i|ii|iii)\)/.test(md)) problems.push("(i)/(ii)/(iii) 표기 남음");
  return problems;
}

export function level2Sections(md: string): { text: string; line: number; body: string }[] {
  const lines = md.split(/\r?\n/);
  const hs = headings(md).filter((h) => h.level === 2);
  return hs.map((h, i) => {
    const end = hs[i + 1]?.line ?? lines.length + 1;
    return { text: h.text, line: h.line, body: lines.slice(h.line - 1, end - 1).join("\n") };
  });
}

export function startDocProblems(md: string): string[] {
  const problems: string[] = [];
  const sections = level2Sections(md);
  const titles = sections.map((s) => s.text);
  if (JSON.stringify(titles) !== JSON.stringify(START_SECTIONS)) {
    problems.push(`## 제목 목록 불일치: ${titles.join(" | ")}`);
  }
  const forbidden: [boolean, string][] = [
    [/^\s*(```|~~~)/m.test(md), "코드 펜스"],
    [/npx/.test(md), "npx"],
    [/STDIO/i.test(md), "STDIO"],
    [md.includes(MCPB_URL), "MCPB_URL"],
    [/pre-?release/i.test(md), "pre-release"],
    [/빌드\s*커밋/.test(md), "빌드 커밋"],
    [/\.mcpb/.test(md), ".mcpb"],
    [md.includes("Claude Desktop"), "Claude Desktop"],
    [/준비\s*중/.test(md), "준비 중"],
  ];
  for (const [hit, label] of forbidden) if (hit) problems.push(`금지 표현: ${label}`);
  const targets = new Set(extractLinks(md).map((l) => l.url));
  const required = [
    "install.md",
    "keyless.md",
    "mcpb.md",
    ...DOC_PAGES.filter((p) => p.parent === "install").map((p) => posix.relative("docs", p.path)),
  ];
  for (const t of required) if (!targets.has(t)) problems.push(`링크 없음: ${t}`);
  const easy = sections.find((s) => s.text === "가장 쉬운 길: " + DESKTOP_APP_NAME);
  const easyLines = easy?.body.split("\n") ?? [];
  if (!easyLines.some((l) => /^\d+\.\s/.test(l))) problems.push("가장 쉬운 길: 번호 목록 없음");
  if (!easyLines.some((l) => /^\d+\.\s/.test(l) && l.includes("](mcpb.md)"))) problems.push("가장 쉬운 길: mcpb.md 안내 링크 없음");
  const stuck = sections.find((s) => s.text === "막히면");
  if (!stuck?.body.includes("두 번")) problems.push("막히면: '두 번' 경고 없음");
  return problems;
}

export const MCPB_FIRST_SECTION = "내려받아 설치하기";

export function mcpbDocProblems(md: string): string[] {
  const problems: string[] = [];
  const sections = level2Sections(md);
  const first = sections[0];
  if (first?.text !== MCPB_FIRST_SECTION) problems.push("mcpb.md 첫 ## 구획이 '내려받아 설치하기'가 아님");
  const body = first?.body ?? "";
  if (!body.includes("](" + MCPB_URL + ")")) problems.push("mcpb.md 첫 구획에 MCPB_URL 내려받기 링크 없음");
  if (!["터미널", "Node.js", "필요 없어요"].every((t) => body.includes(t))) {
    problems.push("mcpb.md 첫 구획에 '터미널/Node.js/필요 없어요' 안내 없음");
  }
  const numbered = body.split("\n").filter((l) => /^\d+\.\s/.test(l));
  if (numbered.length < 3 || !numbered.some((l) => l.includes(DESKTOP_APP_NAME))) {
    problems.push("mcpb.md 첫 구획 번호 목록(3개 이상, 앱 이름 포함) 없음");
  }
  if (!body.includes("모두 선택") || !body.includes("민감 정보")) problems.push("mcpb.md 첫 구획에 API 키 선택·민감 정보 안내 없음");
  if (!["Pre-release", "시험판", "`main`"].every((t) => body.includes(t))) {
    problems.push("mcpb.md 첫 구획에 Pre-release/시험판/`main` 안내 없음");
  }
  if (!body.includes("다시 받아") || !body.includes("미검증")) problems.push("mcpb.md 첫 구획에 재내려받기·미검증 안내 없음");
  const dev = sections.find((s) => s.text.startsWith("개발자 빌드"));
  if (!dev || sections.indexOf(dev) === 0) problems.push("mcpb.md 개발자 빌드 구획 없음 또는 첫 구획");
  else {
    if (!dev.text.includes("선택")) problems.push("mcpb.md 개발자 빌드 구획 제목에 '선택' 없음");
    if (!dev.body.includes("npm run pack:mcpb")) problems.push("mcpb.md 개발자 빌드 구획에 npm run pack:mcpb 없음");
  }
  if (/준비\s*중|올릴\s*예정|게시\s*전/.test(md)) problems.push("mcpb.md에 준비 중/예정/게시 전 표현");
  if (/토큰|수동으로\s*(올리|업로드)/.test(md)) problems.push("mcpb.md에 토큰/수동 업로드 표현");
  return problems;
}

export function indexListLines(pages: readonly DocPage[], href: (p: DocPage) => string): string[] {
  return pages
    .filter((p) => p.id !== "index")
    .map((p) => (p.parent ? "  " : "") + "- [" + p.title + "](" + href(p) + ") — " + p.summary);
}

/** docs/README.md 클라이언트 하위 목록 줄(4칸 들여쓰기). */
export const CLIENT_LIST_LINE = /^ {4}- \[[^\]]+\]\(clients\/[a-z-]+\.md\) — \S/;

/** 줄 수를 유지한 채 조건에 맞는 줄을 빈 줄로 바꾼다. */
export function blankLines(md: string, pred: (line: string) => boolean): string {
  return md.split(/\r?\n/).map((l) => (pred(l) ? "" : l)).join("\n");
}

/** 앱별 문서용: 앱 이름은 허용, "전용" 단정만 금지. */
export function brandExclusiveProblems(file: string, md: string): string[] {
  const problems: string[] = [];
  for (const { line, text } of proseLines(md)) {
    if (CLIENT_BRANDS.some((r) => r.test(text)) && text.includes("전용")) problems.push(`${file}:${line} ${text}`);
  }
  return problems;
}
