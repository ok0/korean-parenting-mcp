import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listDocMarkdown } from "../scripts/docs/files.js";
import { NEGATIVE_NOTICE_PATTERNS, UNOFFICIAL_KO } from "./helpers/affiliation-wording.js";
import { extractLinks, headings } from "./helpers/markdown.js";
import { CLIENT_BRANDS } from "./helpers/visuals.js";
import { matchedPatterns } from "./helpers/wording.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (rel: string): string => readFileSync(join(root, rel), "utf8");

const PVR_URL = "https://github.com/ok0/korean-parenting-mcp/security/advisories/new";
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/;
const VERSION_NUMBER = /\b\d+\.\d+\.\d+\b/;

interface CommunityDocRule {
  file: string;
  title: string;
  sections: readonly string[];
  required: readonly string[];
}

const SECURITY_RULE: CommunityDocRule = {
  file: "SECURITY.md",
  title: "보안 정책",
  sections: ["지원 버전", "취약점 신고", "API 키 다루기", "신고 범위"],
  required: [PVR_URL, "(docs/advanced.md#키-다루기)", "npx -y korean-parenting-mcp@latest", "Node.js 22.12 이상", "abcd****"],
};

const CONTRIBUTING_RULE: CommunityDocRule = {
  file: "CONTRIBUTING.md",
  title: "기여 안내",
  sections: ["시작하기", "이슈와 제안", "변경 보내기", "커밋 메시지", "데이터 추가·수정", "문구 규칙", "라이선스"],
  required: ["Node.js 22.12 이상", "npm ci", "npm run verify", "(SECURITY.md)", "as_of", "MIT", "(LICENSE)"],
};

function communityDocProblems(md: string, rule: CommunityDocRule): string[] {
  const problems: string[] = [];
  const hs = headings(md);
  const h1 = hs.filter((h) => h.level === 1).map((h) => h.text);
  if (JSON.stringify(h1) !== JSON.stringify([rule.title])) problems.push(`제목 불일치: ${h1.join(" | ")}`);
  const h2 = hs.filter((h) => h.level === 2).map((h) => h.text);
  if (JSON.stringify(h2) !== JSON.stringify(rule.sections)) problems.push(`절 목록 불일치: ${h2.join(" | ")}`);
  for (const s of rule.required) if (!md.includes(s)) problems.push(`필수 문구 없음: ${s}`);
  const email = EMAIL.exec(md);
  if (email) problems.push(`이메일 주소: ${email[0]}`);
  const version = VERSION_NUMBER.exec(md);
  if (version) problems.push(`버전 숫자: ${version[0]}`);
  for (const p of matchedPatterns(md, CLIENT_BRANDS)) problems.push(`AI 앱 이름: ${p}`);
  for (const p of matchedPatterns(md, NEGATIVE_NOTICE_PATTERNS)) problems.push(`부정·소속 문구: ${p}`);
  return problems;
}

function swap(md: string, a: string, b: string): string {
  return md.replace(a, "\u0000").replace(b, a).replace("\u0000", b);
}

describe("community docs (M79, ADR-70)", () => {
  it("SECURITY.md and CONTRIBUTING.md exist at the root and follow their rules", () => {
    for (const rule of [SECURITY_RULE, CONTRIBUTING_RULE]) {
      expect(existsSync(join(root, rule.file)), rule.file).toBe(true);
      expect(communityDocProblems(read(rule.file), rule), rule.file).toEqual([]);
    }
  });

  it("SECURITY.md links the private vulnerability form and key handling", () => {
    const urls = extractLinks(read("SECURITY.md")).map((l) => l.url);
    expect(urls).toContain(PVR_URL);
    expect(urls).toContain("docs/advanced.md#키-다루기");
  });

  it("README and docs/ do not link the community docs (ADR-70 (6))", () => {
    for (const f of ["README.md", ...listDocMarkdown(root)]) {
      const hits = extractLinks(read(f))
        .map((l) => l.url)
        .filter((u) => /(^|\/)(SECURITY|CONTRIBUTING)\.md(#|$)/.test(u));
      expect(hits, f).toEqual([]);
    }
  });

  const sec = (): string => read("SECURITY.md");
  const con = (): string => read("CONTRIBUTING.md");
  const samples: { label: string; rule: CommunityDocRule; make: () => string; prefix: string }[] = [
    { label: "email address", rule: SECURITY_RULE, make: () => sec() + "\n문의: someone@example.com\n", prefix: "이메일 주소" },
    { label: "missing section", rule: SECURITY_RULE, make: () => sec().replace("## 신고 범위\n", ""), prefix: "절 목록 불일치" },
    { label: "swapped sections", rule: SECURITY_RULE, make: () => swap(sec(), "## 지원 버전", "## 취약점 신고"), prefix: "절 목록 불일치" },
    { label: "wrong title", rule: SECURITY_RULE, make: () => sec().replace("# 보안 정책", "# 보안"), prefix: "제목 불일치" },
    { label: "no report URL", rule: SECURITY_RULE, make: () => sec().split(PVR_URL).join("https://github.com/ok0/korean-parenting-mcp/issues"), prefix: "필수 문구 없음" },
    { label: "version number", rule: SECURITY_RULE, make: () => sec() + "\n지원: 1.2.3\n", prefix: "버전 숫자" },
    { label: "AI app name", rule: SECURITY_RULE, make: () => sec() + "\nCursor에서 확인해요.\n", prefix: "AI 앱 이름" },
    { label: "affiliation word", rule: SECURITY_RULE, make: () => sec() + `\n${UNOFFICIAL_KO} 도구\n`, prefix: "부정·소속 문구" },
    { label: "negative stem", rule: CONTRIBUTING_RULE, make: () => con() + "\n공개 자료가 아닙니다.\n", prefix: "부정·소속 문구" },
    { label: "contributing missing section", rule: CONTRIBUTING_RULE, make: () => con().replace("## 라이선스", "### 라이선스"), prefix: "절 목록 불일치" },
    { label: "contributing swapped sections", rule: CONTRIBUTING_RULE, make: () => swap(con(), "## 변경 보내기", "## 커밋 메시지"), prefix: "절 목록 불일치" },
  ];

  it.each(samples)("synthetic violation is caught: $label", ({ rule, make, prefix }) => {
    const problems = communityDocProblems(make(), rule);
    expect(problems.some((p) => p.startsWith(prefix)), problems.join("\n")).toBe(true);
  });
});
