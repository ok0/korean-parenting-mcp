import { describe, expect, it } from "vitest";
import { z } from "zod";
import { allTools, defineTool } from "../src/tools/registry.js";
import { boolField, dateField, intField, keywordField } from "../src/tools/shared/schema.js";
import { checkToolMeta } from "./helpers/meta-check.js";
import { badMetaTool, validFixtureTools } from "./helpers/fixture-tools.js";

const doc = { purpose: "테스트 값", format: "형식", example: "예시값" };

function descriptionOf(schema: z.ZodType): string {
  const js = z.toJSONSchema(z.object({ f: schema }), { io: "input" }) as {
    properties: Record<string, { description?: string }>;
  };
  return js.properties.f!.description ?? "";
}

describe("tool meta", () => {
  it("every registered tool passes meta check", () => {
    const names = allTools.map((t) => t.name);
    for (const t of allTools) expect(checkToolMeta(t, names)).toEqual([]);
  });

  it("valid fixture tools pass", () => {
    const names = validFixtureTools.map((t) => t.name);
    for (const t of validFixtureTools) expect(checkToolMeta(t, names)).toEqual([]);
  });

  it("checker rejects missing describe/title and key fields", () => {
    const problems = checkToolMeta(badMetaTool);
    expect(problems).toContain("fx_bad_meta: title 누락");
    expect(problems).toContain("fx_bad_meta.q: describe 누락");
    expect(problems).toContain("fx_bad_meta.serviceKey: 키 필드 노출");
  });

  it("checker rejects cross-tool instruction", () => {
    const dup = defineTool({
      name: "fx_dup",
      title: "중복 지시 (테스트)",
      description: "fx_echo를 먼저 호출",
      schema: z.object({ q: keywordField(doc) }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      handler: async () => ({ body: "x" }),
    });
    const problems = checkToolMeta(dup, ["fx_echo", "fx_dup"]);
    expect(problems.some((p) => p.includes("설명에 다른 도구 지시"))).toBe(true);
  });

  it("dateField accepts three formats and rejects invalid dates", () => {
    const s = dateField(doc);
    for (const ok of ["2026-03-01", "2026.03.01", "20260301", " 2026-03-01 "]) {
      expect(s.safeParse(ok).success).toBe(true);
    }
    for (const bad of ["2026/03/01", "2026-02-30", "20260230", "2026-3-1"]) {
      expect(s.safeParse(bad).success).toBe(false);
    }
    const invalid = s.safeParse("2026-02-30");
    expect(invalid.success).toBe(false);
    if (!invalid.success) {
      const msg = invalid.error.issues[0]!.message;
      expect(msg).toContain("존재하지 않는 날짜");
      expect(msg).toContain("예: 예시값");
    }
    const missing = s.safeParse(undefined);
    expect(missing.success).toBe(false);
    if (!missing.success) {
      expect(missing.error.issues[0]!.message).toContain("예: 예시값");
    }
  });

  it("intField range error includes example", () => {
    const r = intField(doc, { min: 1, max: 3 }).safeParse(4);
    expect(r.success).toBe(false);
    if (!r.success) {
      const msg = r.error.issues[0]!.message;
      expect(msg).toContain("1~3");
      expect(msg).toContain("예: 예시값");
    }
  });

  it("intField accepts ints and numeric strings within range", () => {
    const s = intField(doc, { min: 1, max: 3 });
    expect(s.parse(2)).toBe(2);
    expect(s.parse("2")).toBe(2);
    expect(s.parse(" 3 ")).toBe(3);
    expect(s.safeParse("3.5").success).toBe(false);
    expect(s.safeParse(4).success).toBe(false);
    expect(s.safeParse("x").success).toBe(false);
  });

  it("boolField accepts booleans and true/false strings", () => {
    const s = boolField(doc);
    expect(s.parse(true)).toBe(true);
    expect(s.parse("false")).toBe(false);
    expect(s.safeParse("yes").success).toBe(false);
  });

  it("keywordField trims and rejects empty", () => {
    const s = keywordField(doc);
    expect(s.parse("  안녕 ")).toBe("안녕");
    expect(s.safeParse("").success).toBe(false);
  });

  it("helper descriptions include example", () => {
    expect(descriptionOf(dateField(doc))).toContain("예:");
    expect(descriptionOf(intField(doc, { min: 1, max: 3 }))).toContain("예:");
    expect(descriptionOf(boolField(doc))).toContain("예:");
    expect(descriptionOf(keywordField(doc))).toContain("예:");
  });

  it("helpers throw on empty FieldDoc", () => {
    expect(() => dateField({ purpose: "", format: "x", example: "y" })).toThrow();
  });
});
