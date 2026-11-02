import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findLeaks } from "../scripts/lib/sample-mask.js";
import { SOURCE_NOTICE } from "../src/core/notice.js";
import { ASSET_FILES } from "../scripts/visuals/generate.js";
import { RAW_ASSET_PREFIX, REPORT_FIGURE_ALT, assetPairs } from "../scripts/visuals/readme-figures.js";
import { CLIENT_PAGES, DOC_PAGES, DOCS_BLOB, MCPB_URL, docUrl } from "../scripts/docs/links.js";
import { readmeIntro } from "./helpers/visuals.js";
import { OFFICIAL_CLAIM_OUTPUT, matchedPatterns } from "./helpers/wording.js";
import {
  LINK_BLOCK_LAST_LINE,
  MCPB_DOWNLOAD_LABEL,
  ONE_LINER,
  PAGES_URL,
  README_MAX_LINES,
  clientLinePrefixes,
  expectedLinkBlock,
  lineCount,
  linkBlock,
  readmeClientLines,
  readmeProblems,
} from "./helpers/readme.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const readme = readFileSync(join(root, "README.md"), "utf8");
const license = readFileSync(join(root, "LICENSE"), "utf8");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { description: string };

describe("root documents", () => {
  it("LICENSE is MIT with copyright", () => {
    expect(license.split("\n")[0]).toBe("MIT License");
    expect(license).toMatch(/Copyright \(c\) 2026 ok0/);
    expect(license).toContain("Permission is hereby granted");
  });

  it("README is self-contained and not official-sounding", () => {
    expect(readme).not.toContain(".docs");
    expect(readme).not.toMatch(/(?<!비)공식\s*(서비스|앱|도구|서버|MCP)/);
    expect(readme).not.toMatch(/정부\s*(제공|공식)/);
  });

  it("title and description use the one-liner", () => {
    expect(readme.split("\n").slice(0, 5).join("\n")).toContain(ONE_LINER);
    expect(pkg.description.startsWith(ONE_LINER)).toBe(true);
    expect(pkg.description).toBe(ONE_LINER);
  });

  it("no remote mode and no key-like strings", () => {
    expect(readme).not.toMatch(/원격|remote|Streamable/i);
    expect(findLeaks(readme, [], { heuristic: true })).toEqual([]);
    expect(findLeaks(license, [], { heuristic: true })).toEqual([]);
  });

  it("README follows the lean layout (M39 R1–R13)", () => {
    expect(readmeProblems(readme)).toEqual([]);
    expect(lineCount(readme)).toBeLessThanOrEqual(README_MAX_LINES);
  });

  it("link block lines come from DOC_PAGES and the client list within 33 lines (ADR-51, M39b E1)", () => {
    const b = linkBlock(readme);
    expect(b).not.toBeNull();
    expect(b?.end ?? 99).toBeLessThanOrEqual(LINK_BLOCK_LAST_LINE);
    expect(b?.lines).toEqual(expectedLinkBlock());
    expect(b?.lines[0]).toBe(`처음이라면 → [${DOC_PAGES[0]?.title}](${docUrl("docs/start.md")})`);
    for (const p of DOC_PAGES) {
      if (p.id === "index") continue;
      expect(readme, p.id).toContain(`[${p.title}](${docUrl(p.path)}) — ${p.summary}`);
    }
    expect(readme).toContain(`    - [${MCPB_DOWNLOAD_LABEL}](${MCPB_URL})`);
    expect(MCPB_DOWNLOAD_LABEL).not.toContain(".mcpb");
    expect(readme).not.toContain(docUrl("docs/README.md"));
  });

  it("client sub-list matches docs/README.md and CLIENT_PAGES (M39b R1, R2)", () => {
    const sub = readmeClientLines();
    expect(sub).toHaveLength(CLIENT_PAGES.length);
    const prefixes = clientLinePrefixes();
    sub.forEach((l, i) => expect(l.startsWith(prefixes[i] ?? "@@"), prefixes[i]).toBe(true));
    const L = readme.split("\n");
    const at = L.findIndex((l) => l.includes(`(${docUrl("docs/clients/README.md")})`));
    expect(at).toBeGreaterThanOrEqual(0);
    expect(L.slice(at + 1, at + 1 + sub.length)).toEqual(sub);
    for (const p of CLIENT_PAGES) expect(existsSync(join(root, p.path)), p.path).toBe(true);
    expect(readmeClientLines("    - [X](clients/x.md) — y\n- [Z](z.md) — w\n")).toEqual([`    - [X](${docUrl("docs/clients/x.md")}) — y`]);
  });

  it("synthetic violations fail (R14)", () => {
    const L = readme.split("\n");
    const swap = (a: string, b: string): string => {
      const ia = L.findIndex((l) => l.includes(docUrl(a)));
      const ib = L.findIndex((l) => l.includes(docUrl(b)));
      const out = [...L];
      out[ia] = L[ib] ?? "";
      out[ib] = L[ia] ?? "";
      return out.join("\n");
    };
    const cases: [string, string, string][] = [
      ["81행", readme + "추가 줄\n".repeat(README_MAX_LINES + 1 - lineCount(readme)), "행 이하여야 함"],
      ["금지 제목", readme.replace("## 라이선스", "### 설치와 실행\n\n## 라이선스"), "금지 제목"],
      [
        "순서 위반",
        readme.replace("## 그림으로 보기", "## @@").replace("## 라이선스", "## 그림으로 보기").replace("## @@", "## 라이선스"),
        "제목 구성이 다름",
      ],
      ["상대 docs 링크", readme.replace(`](${docUrl("docs/keyless.md")})`, "](docs/keyless.md)"), "허용되지 않는 링크: docs/keyless.md"],
      [".docs 링크", readme.replace(`](${docUrl("docs/advanced.md")})`, `](${DOCS_BLOB}.docs/notes.md)`), ".docs/ 링크"],
      ["http 스킴", readme.replace(`](${PAGES_URL})`, "](http://ok0.github.io/korean-parenting-mcp/)"), "허용되지 않는 링크: http://"],
      ["배지 이미지", readme.replace(`**${ONE_LINER}**`, `**${ONE_LINER}**\n\n![상태](https://img.shields.io/badge/a-b-blue)`), "마크다운 이미지"],
      ["(ii) 표기", readme.replace("## 그림으로 보기", "- (ii) 모의 응답으로만 검증\n\n## 그림으로 보기"), "(i)/(ii)/(iii)"],
      ["33행 밖", readme.replace(`**${ONE_LINER}**\n`, `**${ONE_LINER}**\n` + "소개 줄\n".repeat(10)), "행 밖에서 끝남"],
      ["항목 누락", L.filter((l) => !l.includes(docUrl("docs/keyless.md"))).join("\n"), "DOC_PAGES와 다름"],
      ["앱 항목 누락", L.filter((l) => !l.includes(docUrl("docs/clients/codex.md"))).join("\n"), "DOC_PAGES와 다름"],
      ["앱 요약 변경", readme.replace("— 명령 한 줄로 서버를 등록해요", "— 명령으로 등록해요"), "DOC_PAGES와 다름"],
      ["앱 들여쓰기 2칸", readme.replace("    - [Cursor](", "  - [Cursor]("), "DOC_PAGES와 다름"],
      ["순서 변경", swap("docs/setup-wizard.md", "docs/clients/README.md"), "DOC_PAGES와 다름"],
      ["라벨에 .mcpb", readme.replace(`[${MCPB_DOWNLOAD_LABEL}]`, "[korean-parenting-mcp.mcpb 내려받기]"), "DOC_PAGES와 다름"],
      ["처음이라면 두 줄", readme.replace("## 그림으로 보기", "처음이라면 여기부터 읽으세요.\n\n## 그림으로 보기"), '"처음이라면"으로 시작하는 줄이 2개'],
      ["고지 없음", L.filter((l) => l !== SOURCE_NOTICE).join("\n"), "출처 고지 없음"],
      ["옛 고지", readme.replace(SOURCE_NOTICE, "정부·공공기관과 관계없는 **비공식** 개인 프로젝트이며, 공공 API와 공개 법령을 바탕으로 안내합니다."), "출처 고지 없음"],
      ["부정형 소속", readme.replace("## 라이선스", "개인 프로젝트입니다.\n\n## 라이선스"), "부정형 소속 고지 금지"],
      ["공식 주장", readme.replace("## 라이선스", "정부 공식 서버입니다.\n\n## 라이선스"), "공식 주장 표현"],
      ["MIT 없음", readme.replace("MIT — ", ""), "MIT 없음"],
    ];
    for (const [name, sample, sub] of cases) {
      expect(sample, name).not.toBe(readme);
      expect(readmeProblems(sample).some((p) => p.includes(sub)), name).toBe(true);
    }
  });
});

describe("README figures (M31)", () => {
  it("every ASSET_FILES light/dark pair has one <picture> with absolute raw URLs", () => {
    const pictures = [...readme.matchAll(/<picture>([\s\S]*?)<\/picture>/g)].map((m) => m[1] ?? "");
    const pairs = assetPairs(ASSET_FILES);
    expect(pictures.length, "ASSET_FILES의 그림 쌍마다 README <picture> 블록이 하나씩 필요합니다").toBe(pairs.length);
    for (const p of pairs) {
      expect(
        pictures.some(
          (pic) =>
            pic.includes(`<source media="(prefers-color-scheme: dark)" srcset="${RAW_ASSET_PREFIX}${p.dark}">`) &&
            pic.includes(`<img src="${RAW_ASSET_PREFIX}${p.light}"`),
        ),
        p.name,
      ).toBe(true);
    }
    for (const f of ASSET_FILES) {
      expect(readme).toContain(RAW_ASSET_PREFIX + f);
    }
  });

  it("README has no relative assets path and every referenced asset exists", () => {
    expect(readme).not.toMatch(/(?:src|srcset|href)="(?!https:\/\/)[^"]*assets\//);
    expect(readme).not.toMatch(/\]\((?!https:\/\/)[^)]*assets\//);
    for (const m of readme.matchAll(/raw\.githubusercontent\.com\/ok0\/korean-parenting-mcp\/main\/assets\/([^"\s)]+)/g)) {
      const name = m[1] ?? "";
      expect(existsSync(join(root, "assets", name)), name).toBe(true);
    }
    // MANUAL: GIF를 만든 뒤 README에 연결하면 이 demo- 검사를 지우세요(.docs/visuals/guide.md 참조).
    expect(readme).not.toContain("demo-");
    expect(readme).not.toMatch(/준비\s*중|coming soon|placeholder|TODO/i);
  });

  it("image alt texts are plain Korean sentences without digits or file names", () => {
    const imgs = [...readme.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
    expect(imgs.length).toBe(assetPairs(ASSET_FILES).length);
    for (const tag of imgs) {
      const alt = /\balt="([^"]*)"/.exec(tag)?.[1] ?? "";
      expect(alt.trim()).not.toBe("");
      expect(alt).not.toMatch(/[0-9]/);
      expect(alt).not.toMatch(/\.svg|\.gif/);
      expect(alt).toMatch(/[가-힣]/);
      expect(alt.trim().endsWith(".")).toBe(true);
    }
  });

  it("figure 4 alt comes from the shared constant and says it is a real answer (M30c)", () => {
    const tag = [...readme.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]).find((t) => t.includes("report-example-light.svg")) ?? "";
    const alt = /\balt="([^"]*)"/.exec(tag)?.[1] ?? "";
    expect(alt).toBe(REPORT_FIGURE_ALT);
    expect(alt).toContain("실제 답변");
    expect(alt).not.toContain(["녹", "화"].join(""));
    expect(alt).not.toContain("ok0");
    expect(alt).not.toMatch(/[0-9]/);
    expect(alt.endsWith(".")).toBe(true);
  });

  it("README intro (top to the link block) mentions the AI helper and claims nothing official", () => {
    const intro = readmeIntro(readme);
    expect(intro).toContain("AI 도우미");
    expect(matchedPatterns(intro, OFFICIAL_CLAIM_OUTPUT)).toEqual([]);
  });

  it("figures sit under ## 그림으로 보기 before the license", () => {
    const fig = readme.indexOf("## 그림으로 보기");
    const lic = readme.indexOf("## 라이선스");
    const pic = readme.indexOf("<picture>");
    expect(fig).toBeGreaterThanOrEqual(0);
    expect(pic).toBeGreaterThan(fig);
    expect(readme.lastIndexOf("</picture>")).toBeLessThan(lic);
  });
});

describe("README Pages link (M33)", () => {
  it("README links the Pages trial in the intro (M33)", () => {
    const intro = readmeIntro(readme);
    expect(intro).toContain("](https://ok0.github.io/korean-parenting-mcp/)");
    expect(intro).toContain("체험");
  });
});
