import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findLeaks, secretsFromEnv } from "../scripts/lib/sample-mask.js";
import { CLIENT_BRANDS } from "./helpers/visuals.js";
import { matchedPatterns } from "./helpers/wording.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const dir = join(root, ".docs/visuals");
const DIAGNOSIS_PROMPT = /진단|처방|복용|투약|해열제|먹여도|먹어도|용량|무슨\s*병|어떤\s*약|괜찮을까/;

const gifPath = join(dir, "gif-scenario.md");
const guidePath = join(dir, "guide.md");
const gifText = existsSync(gifPath) ? readFileSync(gifPath, "utf8") : "";
const guideText = existsSync(guidePath) ? readFileSync(guidePath, "utf8") : "";

describe.skipIf(!existsSync(gifPath))("GIF scenario (M31)", () => {
  const text = gifText;

  it("has two or three scenes, each with the required bullet lines and a non-diagnostic prompt", () => {
    const scenes = text.split(/^## 장면 /m).slice(1);
    expect(scenes.length).toBeGreaterThanOrEqual(2);
    expect(scenes.length).toBeLessThanOrEqual(3);
    for (const s of scenes) {
      expect(s).toMatch(/^- 질문 의도: \S/m);
      expect(s).toMatch(/^- 프롬프트: "([^"]+)"$/m);
      const prompt = /^- 프롬프트: "([^"]+)"$/m.exec(s)?.[1] ?? "";
      expect(prompt).not.toMatch(DIAGNOSIS_PROMPT);
      expect(s).toMatch(/^- 기대 도구: `[a-z_]+`/m);
      expect(s).toMatch(/^- 키 필요: (없음|있음 — \S)/m);
      expect(s).toMatch(/^- 기대 화면: \S/m);
    }
  });

  it("orders scenes with the timeline scene first and marks the recall scene as optional", () => {
    const scenes = text.split(/^## 장면 /m).slice(1);
    expect(scenes[0]).toContain("권장 첫 장면");
    expect(scenes[0]).toContain("`get_timeline`");
    expect(scenes[0]).toContain("- 키 필요: 없음");
    for (const s of scenes) {
      if (s.includes("`check_recall`")) {
        expect(s).toContain("선택 장면");
        expect(s).toContain("키 수령 후");
      }
    }
  });

  it("contains the required recording and linking text", () => {
    for (const phrase of [
      "15초",
      "5MB",
      "assets/demo-<n>.gif",
      '<img src="https://raw.githubusercontent.com/ok0/korean-parenting-mcp/main/assets/demo-1.gif"',
      'alt="',
      "개인정보",
      "설정 화면",
      "가상",
      "화면 기록 시점",
      "MCP 클라이언트",
    ]) {
      expect(text, phrase).toContain(phrase);
    }
  });

  it("names no client or AI product brand", () => {
    expect(matchedPatterns(text, CLIENT_BRANDS)).toEqual([]);
  });

  it("contains no leaked secrets", () => {
    expect(findLeaks(text, secretsFromEnv(process.env), { heuristic: true })).toEqual([]);
  });
});

describe.skipIf(!existsSync(guidePath))("visuals guide (M31)", () => {
  const text = guideText;

  it("contains the required headings, commands, and links", () => {
    for (const phrase of [
      "## 공개 전 README 확인",
      "## 공개 후 점검표",
      "## 그림 다시 만들기",
      "npm run readme:preview",
      "gh auth login",
      "readme-preview.html",
      "증명하지 못하는",
      "curl -I",
      "200",
      "https://raw.githubusercontent.com/ok0/korean-parenting-mcp/main/assets/",
      "npmjs.com",
      "게시한 뒤에만",
      "<picture>",
      "다크",
      "PR 생성 허용",
      "automation/visuals-refresh",
      "npm run visuals:check",
      "npm run visuals",
    ]) {
      expect(text, phrase).toContain(phrase);
    }
  });

  it("covers the page check before publishing (M33)", () => {
    for (const phrase of [
      "## 게시 전 페이지 확인",
      "npm run build:site",
      "python3 -m http.server -d build-site 8080",
      "http://localhost:8080/",
      "증명하는 것",
      "증명하지 못하는",
      "https://ok0.github.io/korean-parenting-mcp/",
      "네트워크",
      "모바일",
      "게시한 뒤에만",
    ]) {
      expect(text, phrase).toContain(phrase);
    }
  });

  it("contains no leaked secrets", () => {
    expect(findLeaks(text, secretsFromEnv(process.env), { heuristic: true })).toEqual([]);
  });
});
