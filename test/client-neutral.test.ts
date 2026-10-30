import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DESKTOP_APP_NAME } from "../scripts/docs/links.js";
import { ASSET_FILES, buildAll } from "../scripts/visuals/generate.js";
import { CLIENT_BRANDS, descText, htmlText, visibleText } from "./helpers/visuals.js";
import { MCPB_DOWNLOAD_LABEL, mcpbLinkLine, readmeBrandProblems, readmeClientLines } from "./helpers/readme.js";
import { matchedPatterns } from "./helpers/wording.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const readme = readFileSync(join(root, "README.md"), "utf8");
const built = buildAll();

describe("client-neutral wording (M30b)", () => {
  it("README names AI products only in the mcpb line and the client sub-list (ADR-49, ADR-51, M39b E2)", () => {
    expect(readmeBrandProblems(readme)).toEqual([]);
    expect(mcpbLinkLine()).toContain(DESKTOP_APP_NAME);
    const branded = (l: string): boolean => CLIENT_BRANDS.some((r) => r.test(l));
    expect(readme.split("\n").filter(branded)).toEqual([mcpbLinkLine(), ...readmeClientLines().filter(branded)]);
    expect(readme).not.toMatch(/\((?:i|ii|iii)\)/);
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
    expect(readmeBrandProblems("# t\nChatGPT에서 써 보세요\n")).toEqual(["README:2 ChatGPT에서 써 보세요"]);
    const second = readme.replace("# korean-parenting-mcp\n", `# korean-parenting-mcp\n${DESKTOP_APP_NAME}에서 써 보세요.\n`);
    expect(readmeBrandProblems(second)).toEqual([`README:2 ${DESKTOP_APP_NAME}에서 써 보세요.`]);
    const label = readme.replace(`[${MCPB_DOWNLOAD_LABEL}]`, `[${DESKTOP_APP_NAME} 설치 파일]`);
    expect(readmeBrandProblems(label)).toHaveLength(1);
    const dup = readme + "\n" + mcpbLinkLine() + "\n";
    expect(readmeBrandProblems(dup)).toHaveLength(1);
    const sub = readmeClientLines();
    const cursorLine = sub.find((l) => l.includes("[Cursor]")) ?? "";
    expect(readmeBrandProblems(readme + "\n" + cursorLine + "\n")).toHaveLength(1);
    expect(readmeBrandProblems(readme.replace("## 라이선스", "Cursor 추천\n\n## 라이선스"))).toHaveLength(1);
    expect(readmeBrandProblems(readme.replace(cursorLine, cursorLine + " 추천"))).toHaveLength(1);
    expect(readme.replace("## 라이선스", "- (ii) 모의 응답\n\n## 라이선스")).toMatch(/\((?:i|ii|iii)\)/);
    expect(
      matchedPatterns(htmlText('<style>a{cursor:pointer}</style><p class="cursor">Claude가 찾아요</p>'), CLIENT_BRANDS),
    ).toEqual(["Claude"]);
    expect(matchedPatterns("Claude가 찾아요 · ChatGPT · Cursor", CLIENT_BRANDS).length).toBeGreaterThanOrEqual(3);
  });
});
