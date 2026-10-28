import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  STAGE_KEYWORDS,
  classifyRegion,
  compareBenefits,
  keywordTerms,
  matchScore,
  matchesFilter,
  stageTerms,
  toBenefitRow,
  type BenefitRow,
  type Scored,
} from "../src/benefits/filter.js";
import { normalizeRegion, type Region } from "../src/region/normalize.js";

const fx = (name: string): string => readFileSync(new URL(`./fixtures/data-go-kr/${name}`, import.meta.url), "utf8");
const fixtureData = (name: string): Record<string, unknown>[] =>
  (JSON.parse(fx(name)) as { data: Record<string, unknown>[] }).data;

const ROW_KEYS = new Set(["id", "name", "field", "userType", "criteria", "summary", "dept", "agency", "registeredAt", "url"]);

function regionOf(input: string): Region {
  const r = normalizeRegion(input);
  if (!r.ok) throw new Error(`fixture region not resolved: ${input}`);
  return r.region;
}

function row(서비스명: string, extra: Record<string, string> = {}): BenefitRow {
  const built = toBenefitRow({ 서비스ID: `T-${서비스명}`, 서비스명, ...extra });
  if (built === undefined) throw new Error("row not built");
  return built;
}

describe("toBenefitRow", () => {
  it("keeps only needed fields", () => {
    const [first] = fixtureData("benefitsList/list.json");
    const built = toBenefitRow(first ?? {});
    expect(built).toBeDefined();
    const keys = Object.keys(built ?? {});
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((k) => ROW_KEYS.has(k))).toBe(true);
    expect(keys.some((k) => /[가-힣]/.test(k))).toBe(false);
  });

  it("returns undefined without 서비스ID", () => {
    expect(toBenefitRow({ 서비스명: "이름만 있음" })).toBeUndefined();
  });
});

describe("stage matching", () => {
  it("uses one keyword table for each stage", () => {
    const unrelated = toBenefitRow(fixtureData("benefitsList/list.json")[0] ?? {});
    expect(unrelated).toBeDefined();
    for (const stage of ["pregnancy", "birth", "infant"] as const) {
      const keyword = STAGE_KEYWORDS[stage][0] ?? "";
      const hit = row(`테스트 ${keyword} 지원`);
      expect(matchesFilter(hit, stage, [])).toBe(true);
      expect(matchesFilter(unrelated ?? hit, stage, [])).toBe(false);
    }
  });

  it("builds the all stage from the union of the three sets", () => {
    const expected = new Set([...STAGE_KEYWORDS.pregnancy, ...STAGE_KEYWORDS.birth, ...STAGE_KEYWORDS.infant]);
    expect(new Set(stageTerms("all"))).toEqual(expected);
    expect(matchesFilter(row("산후조리 지원"), "all", [])).toBe(true);
  });
});

describe("keyword matching", () => {
  it("splits keywords on whitespace and requires every term", () => {
    expect(keywordTerms("첫만남  이용권")).toEqual(["첫만남", "이용권"]);
    expect(keywordTerms(undefined)).toEqual([]);
    const both = row("첫만남 이용권 지급");
    const one = row("첫만남 지원");
    const terms = keywordTerms("첫만남  이용권");
    expect(matchesFilter(both, "all", terms)).toBe(true);
    expect(matchesFilter(one, "all", terms)).toBe(false);
  });

  it("requires both stage and keyword to match", () => {
    const terms = keywordTerms("첫만남 이용권");
    expect(matchesFilter(row("첫만남 이용권 지급"), "birth", terms)).toBe(true);
    expect(matchesFilter(row("첫만남 이용권 지급"), "pregnancy", terms)).toBe(false);
  });
});

describe("real fixture rows", () => {
  const rows = [...fixtureData("benefitsList/list.json"), ...fixtureData("benefitsList/page2-large.json")]
    .map((r) => toBenefitRow(r))
    .filter((r): r is BenefitRow => r !== undefined);

  it("classifies the 난임 row as pregnancy", () => {
    const target = rows.find((r) => r.name.includes("[성북구]난임부부 약제비 지원"));
    expect(target).toBeDefined();
    expect(matchesFilter(target ?? row("x"), "pregnancy", [])).toBe(true);
    const others = rows.filter((r) => !r.name.includes("난임부부"));
    expect(others.length).toBeGreaterThan(0);
    for (const other of others) {
      expect(matchesFilter(other, "pregnancy", [])).toBe(false);
      expect(matchesFilter(other, "birth", [])).toBe(false);
    }
  });
});

describe("classifyRegion", () => {
  it("classifies sigungu targets (성동구)", () => {
    const seongdong = regionOf("성동구");
    expect(classifyRegion(row("지원", { 소관기관명: "서울특별시 성동구" }), seongdong)).toBe("local");
    expect(classifyRegion(row("[성동구]출산축하금"), seongdong)).toBe("local");
    expect(classifyRegion(row("지원", { 소관기관명: "서울특별시" }), seongdong)).toBe("local");
    expect(classifyRegion(row("지원", { 소관기관명: "서울특별시 강남구" }), seongdong)).toBe("other");
    expect(classifyRegion(row("지원", { 부서명: "강남구 보건소" }), seongdong)).toBe("other");
    expect(classifyRegion(row("지원", { 소관기관명: "부산광역시 중구" }), seongdong)).toBe("other");
    expect(classifyRegion(row("지원", { 소관기관명: "보건복지부" }), seongdong)).toBe("national");
    expect(classifyRegion(row("지원", { 소관기관명: "국세청" }), seongdong)).toBe("national");
  });

  it("classifies other-sido agencies as other for sido and sigungu targets", () => {
    const gyeonggi = regionOf("경기도");
    expect(classifyRegion(row("지원", { 소관기관명: "서울특별시" }), gyeonggi)).toBe("other");
    expect(classifyRegion(row("지원", { 소관기관명: "경기도" }), gyeonggi)).toBe("local");
    expect(classifyRegion(row("지원", { 소관기관명: "경기도청" }), gyeonggi)).toBe("local");
    expect(classifyRegion(row("지원", { 소관기관명: "한국사회보장정보원" }), gyeonggi)).toBe("national");
    expect(classifyRegion(row("출산 지원"), gyeonggi)).toBe("national");
    const yeongtong = regionOf("수원시 영통구");
    expect(classifyRegion(row("지원", { 소관기관명: "서울특별시" }), yeongtong)).toBe("other");
  });

  it("classifies sido-only targets (경기도)", () => {
    const gyeonggi = regionOf("경기도");
    expect(gyeonggi.code).toBeUndefined();
    expect(classifyRegion(row("지원", { 소관기관명: "경기도 수원시" }), gyeonggi)).toBe("local");
    expect(classifyRegion(row("지원", { 소관기관명: "서울특별시 성북구" }), gyeonggi)).toBe("other");
    expect(classifyRegion(row("지원", { 소관기관명: "보건복지부" }), gyeonggi)).toBe("national");
  });

  it("classifies a sigungu under a parent city (수원시 영통구)", () => {
    const yeongtong = regionOf("수원시 영통구");
    expect(classifyRegion(row("지원", { 소관기관명: "경기도 수원시" }), yeongtong)).toBe("local");
    expect(classifyRegion(row("지원", { 소관기관명: "경기도 수원시 영통구" }), yeongtong)).toBe("local");
    expect(classifyRegion(row("지원", { 소관기관명: "경기도 수원시 장안구" }), yeongtong)).toBe("other");
  });

  it("treats 성북구청 as 성북구", () => {
    const seongbuk = regionOf("성북구");
    expect(classifyRegion(row("지원", { 소관기관명: "성북구청" }), seongbuk)).toBe("local");
  });
});

describe("compareBenefits order", () => {
  it("orders local before national, then score, date and id", () => {
    const items: Scored[] = [
      { row: { id: "p", name: "p", registeredAt: "20240101" }, score: 1, regionClass: "local" },
      { row: { id: "q", name: "q", registeredAt: "20240301" }, score: 1, regionClass: "local" },
      { row: { id: "r", name: "r", registeredAt: "20200101" }, score: 2, regionClass: "local" },
      { row: { id: "n", name: "n", registeredAt: "20260101" }, score: 9, regionClass: "national" },
    ];
    const ids = [...items].sort(compareBenefits).map((s) => s.row.id);
    expect(ids).toEqual(["r", "q", "p", "n"]);

    const tie: Scored[] = [
      { row: { id: "b", name: "b", registeredAt: "20240101" }, score: 1 },
      { row: { id: "a", name: "a", registeredAt: "20240101" }, score: 1 },
    ];
    expect(tie.sort(compareBenefits).map((s) => s.row.id)).toEqual(["a", "b"]);

    const withOther: Scored[] = [
      { row: { id: "o", name: "o", registeredAt: "20260101" }, score: 9, regionClass: "other" },
      { row: { id: "n", name: "n", registeredAt: "20200101" }, score: 1, regionClass: "national" },
      { row: { id: "l", name: "l", registeredAt: "20200101" }, score: 1, regionClass: "local" },
    ];
    expect(withOther.sort(compareBenefits).map((s) => s.row.id)).toEqual(["l", "n", "o"]);
  });

  it("scores name hits above other hits", () => {
    expect(matchScore(row("임신 지원"), ["임신"])).toBe(2);
    expect(matchScore(row("지원", { 서비스목적요약: "임신부 대상" }), ["임신"])).toBe(1);
    expect(matchScore(row("지원"), ["임신"])).toBe(0);
  });
});
