import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SOURCE_NOTICE } from "../src/core/notice.js";

describe("source notice", () => {
  it("SOURCE_NOTICE is the fixed positive wording", () => {
    expect(SOURCE_NOTICE).toBe("공공기관이 제공하는 공개 API와 자료를 이용해 정리해 드려요. 최종 확인은 해당 기관에서 해 주세요.");
  });

  it("notice.ts has no imports", () => {
    const text = readFileSync(fileURLToPath(new URL("../src/core/notice.ts", import.meta.url)), "utf8");
    expect(/^\s*import\s/m.test(text)).toBe(false);
  });

  it("SOURCE_NOTICE has no affiliation-negating wording", () => {
    expect(SOURCE_NOTICE).not.toMatch(/비공식|unofficial|아닙니다|아니며|관계없/i);
  });
});
