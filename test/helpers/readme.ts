import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CLIENT_PAGES, DOC_PAGES, DOCS_BLOB, MCPB_URL, docUrl, type DocPage } from "../../scripts/docs/links.js";
import { RAW_ASSET_PREFIX } from "../../scripts/visuals/readme-figures.js";
import { CLIENT_LIST_LINE, indexListLines } from "./docs-checklist.js";
import { extractLinks, headings } from "./markdown.js";
import { CLIENT_BRANDS, LINK_BLOCK_HEADING } from "./visuals.js";
import { OFFICIAL_CLAIM_OUTPUT, matchedPatterns } from "./wording.js";
import { REFERENCE_NOTICE, SOURCE_NOTICE } from "../../src/core/notice.js";

export const README_MAX_LINES = 80;
export const LINK_BLOCK_LAST_LINE = 33;
export const ONE_LINER = "한국 임신·출산·육아 정보 MCP 서버";
export const PAGES_URL = "https://ok0.github.io/korean-parenting-mcp/";
export const MCPB_DOWNLOAD_LABEL = "설치 파일 바로 내려받기";

export const README_HEADINGS: readonly string[] = ["# korean-parenting-mcp", "## 바로가기", "## 그림으로 보기", "## 출처와 이용 조건", "## 라이선스"];

export const FORBIDDEN_README_HEADINGS: readonly RegExp[] = [/설치와\s*실행/, /설정\s*마법사/, /확장|\.mcpb/i, /선택·고급\s*기능/, /키\s*없이\s*쓰는\s*기능/];

export function splitLines(md: string): string[] {
  const out = md.split(/\r?\n/);
  if (out[out.length - 1] === "") out.pop();
  return out;
}

export function lineCount(md: string): number {
  return splitLines(md).length;
}

function page(id: string): DocPage {
  const p = DOC_PAGES.find((d) => d.id === id);
  if (!p) throw new Error(`DOC_PAGES에 ${id} 없음`);
  return p;
}

export function mcpbLinkLine(): string {
  const m = page("mcpb");
  return `  - [${m.title}](${docUrl(m.path)}) — ${m.summary}`;
}

const DOCS_INDEX = fileURLToPath(new URL("../../docs/README.md", import.meta.url));

/** README 바로가기의 AI 앱별 하위 목록(M39b E1·E2): docs/README.md 클라이언트 줄을 절대 URL로 바꾼 것. */
export function readmeClientLines(indexMd: string = readFileSync(DOCS_INDEX, "utf8")): string[] {
  return splitLines(indexMd)
    .filter((l) => CLIENT_LIST_LINE.test(l))
    .map((l) => l.replace("](clients/", `](${docUrl("docs/clients/")}`));
}

/** CLIENT_PAGES 순서·이름·경로로 만든 하위 목록 줄 접두사. */
export function clientLinePrefixes(): string[] {
  return CLIENT_PAGES.map((p) => `    - [${p.name}](${docUrl(p.path)}) — `);
}

export function expectedLinkBlock(): string[] {
  const s = page("start");
  const out: string[] = [`처음이라면 → [${s.title}](${docUrl(s.path)})`];
  const allowed = mcpbLinkLine();
  const c = page("clients");
  const clientsLine = `  - [${c.title}](${docUrl(c.path)}) — ${c.summary}`;
  const clients = readmeClientLines();
  for (const line of indexListLines(DOC_PAGES, (p) => docUrl(p.path))) {
    out.push(line);
    if (line === allowed) out.push(`    - [${MCPB_DOWNLOAD_LABEL}](${MCPB_URL})`);
    if (line === clientsLine) out.push(...clients);
  }
  return out;
}

export interface LinkBlock {
  start: number;
  end: number;
  lines: string[];
}

export function linkBlock(md: string): LinkBlock | null {
  const lines = splitLines(md);
  const h = lines.indexOf(LINK_BLOCK_HEADING);
  if (h < 0) return null;
  const taken: string[] = [];
  let end = h + 1;
  for (let j = h + 1; j < lines.length; j++) {
    const t = lines[j] ?? "";
    if (t.trim() === "") continue;
    if (t.startsWith("처음이라면 →") || /^ *- \[/.test(t)) {
      taken.push(t);
      end = j + 1;
      continue;
    }
    break;
  }
  return { start: h + 1, end, lines: taken };
}

const NEG_AFFILIATION = new RegExp([["비", "공식"], ["un", "official"], ["관계", "없는"], ["개인 ", "프로젝트"]].map((p) => p.join("")).join("|"), "i");

export function readmeProblems(md: string): string[] {
  const problems: string[] = [];

  const n = lineCount(md);
  if (n > README_MAX_LINES) problems.push(`README ${n}행 — ${README_MAX_LINES}행 이하여야 함`);

  const hs = headings(md);
  const actual = hs.map((h) => "#".repeat(h.level) + " " + h.text);
  if (JSON.stringify(actual) !== JSON.stringify(README_HEADINGS)) {
    problems.push(`README 제목 구성이 다름: ${actual.join(" / ")}`);
  }
  for (const h of hs) {
    if (FORBIDDEN_README_HEADINGS.some((re) => re.test(h.text))) problems.push(`금지 제목: ${h.text}`);
  }

  if (!splitLines(md).slice(0, 5).join("\n").includes(ONE_LINER)) problems.push("한 줄 소개가 5행 안에 없음");

  const i = md.indexOf(LINK_BLOCK_HEADING);
  const intro = i < 0 ? md : md.slice(0, i);
  if (!intro.includes(`](${PAGES_URL})`) || !intro.includes("체험")) problems.push("소개부에 체험 링크 없음");

  const b = linkBlock(md);
  if (b === null) {
    problems.push("바로가기 제목 없음");
  } else {
    if (b.end > LINK_BLOCK_LAST_LINE) problems.push(`바로가기 링크 블록이 ${LINK_BLOCK_LAST_LINE}행 밖에서 끝남(${b.end}행)`);
    if (JSON.stringify(b.lines) !== JSON.stringify(expectedLinkBlock())) problems.push("바로가기 링크 블록이 DOC_PAGES와 다름");
  }

  const starts = splitLines(md).filter((l) => l.startsWith("처음이라면")).length;
  if (starts !== 1) problems.push(`"처음이라면"으로 시작하는 줄이 ${starts}개`);

  for (const { url } of extractLinks(md)) {
    if (!url.startsWith("https://")) {
      problems.push(`허용되지 않는 링크: ${url}`);
    } else if (url.startsWith(DOCS_BLOB + ".docs/")) {
      problems.push(`.docs/ 링크: ${url}`);
    }
  }

  if (/!\[[^\]]*\]\(/.test(md)) problems.push("마크다운 이미지(배지) 금지");
  if (/shields\.io/i.test(md)) problems.push("배지 금지");
  for (const m of md.matchAll(/<img\b[^>]*\bsrc="([^"]*)"/g)) {
    const src = m[1] ?? "";
    if (!src.startsWith(RAW_ASSET_PREFIX)) problems.push(`그림 외 이미지: ${src}`);
  }

  if (/\((?:i|ii|iii)\)/.test(md)) problems.push("옛 상태 표기 (i)/(ii)/(iii) 금지");

  const lines = splitLines(md);
  const fig = lines.indexOf("## 그림으로 보기");
  if (b !== null && fig >= 0) {
    const region = lines.slice(b.end, fig).filter((l) => l.trim() !== "");
    const sentences = (l: string): number => (l.match(/[.?!](?=\s|$)/g) ?? []).length;
    const notice = region.find((l) => l.includes("공공기관이 제공하는"));
    const med = region.find((l) => l.includes("의료진"));
    if (notice !== SOURCE_NOTICE) problems.push("출처 고지 없음");
    if (med !== REFERENCE_NOTICE) problems.push("의료·법률 면책 없음");
    for (const line of [notice, med]) {
      if (line === undefined) continue;
      const k = sentences(line);
      if (k < 1 || k > 2) problems.push(`고지·면책 문장 수 ${k}(1~2문장)`);
    }
    if (region.length !== 2) problems.push("바로가기와 그림 사이에는 고지·면책 두 문단만");
  }

  if (NEG_AFFILIATION.test(md)) problems.push("부정형 소속 고지 금지");

  const claims = matchedPatterns(md, OFFICIAL_CLAIM_OUTPUT);
  if (claims.length > 0) problems.push(`공식 주장 표현: ${claims.join(", ")}`);

  const lic = md.indexOf("## 라이선스");
  if (lic < 0 || !md.slice(lic).includes("MIT")) problems.push("라이선스 구획에 MIT 없음");

  return problems;
}

export function readmeBrandProblems(md: string): string[] {
  const allowed = mcpbLinkLine();
  const b = linkBlock(md);
  const problems: string[] = [];
  let used = false;
  const clientAllowed = new Set(readmeClientLines());
  const seen = new Set<string>();
  const lines = splitLines(md);
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i] ?? "";
    if (!CLIENT_BRANDS.some((re) => re.test(t))) continue;
    if (!used && b && i + 1 > b.start && i + 1 <= b.end && t === allowed) {
      used = true;
      continue;
    }
    if (b && i + 1 > b.start && i + 1 <= b.end && clientAllowed.has(t) && !seen.has(t)) {
      seen.add(t);
      continue;
    }
    problems.push(`README:${i + 1} ${t}`);
  }
  return problems;
}
