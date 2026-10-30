import { describe, expect, it } from "vitest";
import { codeBlocks, extractLinks, headingAnchors, headings } from "./helpers/markdown.js";

describe("markdown helper (M34)", () => {
  it("extracts five link forms with line numbers", () => {
    const md = [
      "[가](docs/a.md)",
      '![그림](assets/x.svg "t")',
      '<a href="https://e.com/x">e</a>',
      '<img src="i.svg" alt="">',
      '<source media="(prefers-color-scheme: dark)" srcset="d.svg">',
      "[![b](b.svg)](https://b.com)",
      "[r]: https://ref.com",
    ].join("\n");
    expect(extractLinks(md)).toEqual([
      { url: "docs/a.md", line: 1 },
      { url: "assets/x.svg", line: 2 },
      { url: "https://e.com/x", line: 3 },
      { url: "i.svg", line: 4 },
      { url: "d.svg", line: 5 },
      { url: "b.svg", line: 6 },
      { url: "https://b.com", line: 6 },
      { url: "https://ref.com", line: 7 },
    ]);
  });

  it("ignores fenced and inline code", () => {
    const md = [
      "```md",
      "[x](no.md)",
      '<a href="no">',
      "```",
      "~~~",
      "[y](no2.md)",
      "~~~",
      "`[z](no3.md)` 그리고 [ok](yes.md)",
    ].join("\n");
    expect(extractLinks(md)).toEqual([{ url: "yes.md", line: 8 }]);
  });

  it("slugs Korean, punctuation and duplicates", () => {
    const md = [
      "# 설치와 실행",
      "## 선택·고급 기능(API 키)",
      "## 데스크톱 앱 확장(.mcpb)",
      "## Node.js 20.19+ 요구",
      "## A & B",
      "## `npx` 실행",
      "## [링크](x.md) 제목",
      "## 예시",
      "## 예시",
      "## 예시",
      "```",
      "# 펜스 안",
      "```",
    ].join("\n");
    expect(headingAnchors(md)).toEqual(
      new Set([
        "설치와-실행",
        "선택고급-기능api-키",
        "데스크톱-앱-확장mcpb",
        "nodejs-2019-요구",
        "a--b",
        "npx-실행",
        "링크-제목",
        "예시",
        "예시-1",
        "예시-2",
      ]),
    );
  });

  it("headings and codeBlocks", () => {
    expect(headings("# T\n\n## 둘 ##\n")).toEqual([
      { level: 1, text: "T", line: 1 },
      { level: 2, text: "둘", line: 3 },
    ]);
    expect(codeBlocks("a\n```json title\n{}\n[]\n```\n```\nx\n")).toEqual([
      { lang: "json", body: "{}\n[]", line: 2 },
      { lang: "", body: "x", line: 6 },
    ]);
  });
});
