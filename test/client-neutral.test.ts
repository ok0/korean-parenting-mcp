import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ASSET_FILES, buildAll } from "../scripts/visuals/generate.js";
import { CLIENT_BRANDS, descText, htmlText, readmeIntro, visibleText } from "./helpers/visuals.js";
import { matchedPatterns } from "./helpers/wording.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const readme = readFileSync(join(root, "README.md"), "utf8");
const built = buildAll();

describe("client-neutral wording (M30b)", () => {
  it("README intro names no AI product", () => {
    expect(matchedPatterns(readmeIntro(readme), CLIENT_BRANDS)).toEqual([]);
  });

  it("every figure names no AI product in visible text or description", () => {
    for (const f of ASSET_FILES) {
      const svg = built[f] ?? "";
      expect(matchedPatterns(visibleText(svg) + "\n" + descText(svg), CLIENT_BRANDS), f).toEqual([]);
    }
    for (const f of ["tool-map-light.svg", "report-example-light.svg"]) {
      expect(visibleText(built[f] ?? ""), f).toContain("AI 도우미");
    }
  });

  it.skipIf(!existsSync(join(root, "site/index.html")))("Pages page text names no AI product", () => {
    const html = readFileSync(join(root, "site/index.html"), "utf8");
    expect(matchedPatterns(htmlText(html), CLIENT_BRANDS)).toEqual([]);
  });

  it("the check catches a product name", () => {
    expect(matchedPatterns(readmeIntro("# t\nChatGPT에서 써 보세요\n## 설치와 실행\nClaude Desktop"), CLIENT_BRANDS)).toHaveLength(1);
    expect(
      matchedPatterns(htmlText('<style>a{cursor:pointer}</style><p class="cursor">Claude가 찾아요</p>'), CLIENT_BRANDS),
    ).toEqual(["Claude"]);
    expect(matchedPatterns("Claude가 찾아요 · ChatGPT · Cursor", CLIENT_BRANDS).length).toBeGreaterThanOrEqual(3);
  });
});
