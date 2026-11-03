import { describe, expect, it } from "vitest";
import { z } from "zod";
import { KEY_GUIDE } from "../src/core/errors.js";
import { SERVER_INSTRUCTIONS } from "../src/server/instructions.js";
import { allTools, defineTool } from "../src/tools/registry.js";
import { boolField, dateField, intField, keywordField } from "../src/tools/shared/schema.js";
import { checkToolMeta } from "./helpers/meta-check.js";
import { badMetaTool, validFixtureTools } from "./helpers/fixture-tools.js";
import { REMOTE_PROMISE_PATTERNS } from "./helpers/remote-wording.js";
import { OFFICIAL_CLAIM_META, matchedPatterns } from "./helpers/wording.js";

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

  it("registered tool descriptions carry no unofficial or negative affiliation wording", () => {
    for (const t of allTools) {
      expect(t.description, t.name).not.toMatch(/비공식|unofficial|무관/i);
      expect(t.description, t.name).not.toMatch(/관계없는|비제휴|만든 서비스는 아니|제휴\s*아님|개인 프로젝트|(공식|공공기관|정부)[^.\n]{0,20}(아니에요|아닙니다|아니며|아니고|아님)/);
      expect(t.description, t.name).not.toContain("공공기관이 제공하는 공개 API");
      expect(matchedPatterns(t.description, OFFICIAL_CLAIM_META), t.name).toEqual([]);
    }
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

  it("checker rejects official-service wording", () => {
    const official = defineTool({
      name: "fx_official",
      title: "테스트",
      description: "아이사랑에서 제공하는 공식 조회 서비스",
      schema: z.object({ q: keywordField(doc) }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      handler: async () => ({ body: "" }),
    });
    expect(checkToolMeta(official)).toContain("fx_official: 공식 서비스 오해 표현");
    const unofficial = defineTool({
      name: "fx_official",
      title: "테스트",
      description: "비공식 참고 도구",
      schema: z.object({ q: keywordField(doc) }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      handler: async () => ({ body: "" }),
    });
    expect(checkToolMeta(unofficial).some((p) => p.includes("공식 서비스 오해 표현"))).toBe(false);
  });

  it("new tools are registered with expected hints", () => {
    const recall = allTools.find((t) => t.name === "check_recall")!;
    expect(recall.annotations.openWorldHint).toBe(true);
    expect(recall.requiredKeys).toEqual(["SAFETYKOREA"]);
    const daycare = allTools.find((t) => t.name === "find_daycare")!;
    expect(daycare.annotations.openWorldHint).toBe(false);
    expect(daycare.requiredKeys).toBeUndefined();
    const vaccination = allTools.find((t) => t.name === "find_vaccination_clinic")!;
    expect(vaccination.annotations.openWorldHint).toBe(false);
    expect(vaccination.annotations.idempotentHint).toBe(true);
    expect(vaccination.requiredKeys).toBeUndefined();
    const checkup = allTools.find((t) => t.name === "find_checkup_clinic")!;
    expect(checkup.annotations.openWorldHint).toBe(true);
    expect(checkup.annotations.idempotentHint).toBe(true);
    expect(checkup.requiredKeys).toBeUndefined();
    const kindergarten = allTools.find((t) => t.name === "find_kindergarten")!;
    expect(kindergarten.annotations.openWorldHint).toBe(true);
    expect(kindergarten.annotations.idempotentHint).toBe(true);
    expect(kindergarten.requiredKeys).toEqual(["KINDERGARTEN"]);
  });

  it("checkup description and instructions explain key behavior", () => {
    const checkup = allTools.find((t) => t.name === "find_checkup_clinic")!;
    expect(checkup.description).toContain("DATA_GO_KR_SERVICE_KEY");
    expect(checkup.description).toContain("키가 없거나");
    expect(SERVER_INSTRUCTIONS).toContain("find_checkup_clinic(키 없으면 링크 안내");
    expect(SERVER_INSTRUCTIONS).toContain("find_checkup_clinic이 지역 검진기관을 조회");
    expect(matchedPatterns(checkup.description, REMOTE_PROMISE_PATTERNS)).toEqual([]);
    expect(matchedPatterns(SERVER_INSTRUCTIONS, REMOTE_PROMISE_PATTERNS)).toEqual([]);
    expect(matchedPatterns(checkup.description, OFFICIAL_CLAIM_META)).toEqual([]);
    expect(KEY_GUIDE.DATA_GO_KR.tools).toEqual(["find_night_pediatric", "find_benefits", "check_pregnancy_drug"]);
  });

  it("checker rejects kindergarten portal claims", () => {
    const claim = defineTool({
      name: "fx_kg",
      title: "테스트",
      description: "유치원알리미 연동 조회",
      schema: z.object({ q: keywordField(doc) }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      handler: async () => ({ body: "" }),
    });
    expect(checkToolMeta(claim)).toContain("fx_kg: 공식 서비스 오해 표현");
    const unofficial = defineTool({
      name: "fx_kg",
      title: "테스트",
      description: "유치원알리미 공시 정보를 요약하는 비공식 참고 도구",
      schema: z.object({ q: keywordField(doc) }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      handler: async () => ({ body: "" }),
    });
    expect(checkToolMeta(unofficial).some((p) => p.includes("공식 서비스 오해 표현"))).toBe(false);
  });

  it("checker rejects portal-name wording", () => {
    const portal = defineTool({
      name: "fx_portal",
      title: "테스트",
      description: "예방접종도우미 위탁의료기관 조회",
      schema: z.object({ q: keywordField(doc) }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      handler: async () => ({ body: "" }),
    });
    expect(checkToolMeta(portal)).toContain("fx_portal: 공식 서비스 오해 표현");
    const nhis = defineTool({
      name: "fx_portal",
      title: "테스트",
      description: "건강iN 검진기관 조회",
      schema: z.object({ q: keywordField(doc) }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      handler: async () => ({ body: "" }),
    });
    expect(checkToolMeta(nhis)).toContain("fx_portal: 공식 서비스 오해 표현");
    const unofficial = defineTool({
      name: "fx_portal",
      title: "테스트",
      description: "비공식 참고 도구",
      schema: z.object({ q: keywordField(doc) }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      handler: async () => ({ body: "" }),
    });
    expect(checkToolMeta(unofficial).some((p) => p.includes("공식 서비스 오해 표현"))).toBe(false);
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

  it("keyed safety and clinic tools use positive wording in descriptions and fields", () => {
    const stem = /아니|아닌|아님|아닙/;
    for (const name of ["check_pregnancy_drug", "check_recall", "find_kindergarten", "find_night_pediatric"]) {
      const t = allTools.find((x) => x.name === name);
      expect(t, name).toBeDefined();
      expect(t!.description, name).not.toMatch(stem);
      expect(JSON.stringify(z.toJSONSchema(t!.schema, { io: "input" })), name).not.toMatch(stem);
    }
    const night = allTools.find((x) => x.name === "find_night_pediatric")!;
    expect(night.description).toContain("진료 시간 외");
    expect(night.description).not.toContain("진료 시간 아님");
  });
});
