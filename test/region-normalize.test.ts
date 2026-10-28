import { describe, expect, it } from "vitest";
import { normalizeRegion, nemcQuery } from "../src/region/normalize.js";
import { loadData } from "../src/data-store/load.js";
import { regionField, REGION_FIELD_DOC } from "../src/tools/shared/schema.js";

describe("normalizeRegion 성공", () => {
  it("resolves a bare sigungu name", () => {
    expect(normalizeRegion("성동구")).toEqual({
      ok: true,
      region: { sido: "서울특별시", sigungu: "성동구", code: "11200" },
    });
  });

  it("treats sido-prefixed variants as the same region", () => {
    const variants = ["서울 성동구", "서울특별시 성동구", "서울시 성동구", "  서울   성동구 ", "서울성동구", "성동구\t"];
    const expected = { ok: true, region: { sido: "서울특별시", sigungu: "성동구", code: "11200" } };
    for (const v of variants) {
      expect(normalizeRegion(v)).toEqual(expected);
    }
  });

  it("resolves city-level sigungu with parent city name", () => {
    const variants = ["수원 영통구", "수원시 영통구", "경기 수원시 영통구", "수원시영통구"];
    for (const v of variants) {
      expect(normalizeRegion(v)).toEqual({
        ok: true,
        region: { sido: "경기도", sigungu: "수원시 영통구", code: "41117" },
      });
    }
  });

  it("resolves sido-only input without sigungu", () => {
    for (const v of ["서울", "서울특별시"]) {
      const r = normalizeRegion(v);
      expect(r).toEqual({ ok: true, region: { sido: "서울특별시" } });
      expect(r.ok && r.region.sigungu).toBeFalsy();
    }
  });

  it("resolves 군위군 to 대구광역시", () => {
    expect(normalizeRegion("군위군")).toEqual({
      ok: true,
      region: { sido: "대구광역시", sigungu: "군위군", code: "27720" },
    });
  });

  it("resolves 광주 북구 under the merged sido", () => {
    expect(normalizeRegion("광주 북구")).toEqual({
      ok: true,
      region: { sido: "전남광주통합특별시", sigungu: "북구", code: "12300" },
    });
  });

  it("resolves 제주시", () => {
    const r = normalizeRegion("제주시");
    expect(r.ok && r.region.code).toBe("50110");
  });
});

describe("normalizeRegion 모호", () => {
  it("returns ambiguous candidates for 중구 across sido", () => {
    const r = normalizeRegion("중구");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("ambiguous");
    expect(r.candidates.length).toBeGreaterThanOrEqual(2);
    expect(r.candidates).toContainEqual({ sido: "서울특별시", sigungu: "중구", code: "11140" });
    expect(r.candidates.some((c) => c.sido.includes("인천"))).toBe(false);
  });
});

describe("normalizeRegion 폐지", () => {
  it("reports abolished 서구 of 인천 with successor candidates", () => {
    for (const v of ["인천 서구", "인천광역시 서구"]) {
      const r = normalizeRegion(v);
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.reason).toBe("ambiguous");
      expect(r.abolished).toBeDefined();
      expect(r.message).toContain("폐지");
      expect(r.candidates.map((c) => c.code).sort()).toEqual(["28275", "28290"]);
      const names = r.candidates.map((c) => c.sigungu ?? "").join(" ");
      expect(names).toContain("서해구");
      expect(names).toContain("검단구");
    }
  });

  it("reports abolished 군위군 with 경상북도 input", () => {
    const r = normalizeRegion("경상북도 군위군");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.candidates.map((c) => c.code)).toEqual(["27720"]);
  });
});

describe("normalizeRegion 구 단위 이하", () => {
  it("rejects dong-level and road-level input with guidance", () => {
    for (const v of ["성수동", "서울 성동구 성수동", "왕십리로 222"]) {
      const r = normalizeRegion(v);
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.reason).toBe("unknown");
      expect(r.message).toContain("구 단위로 입력");
    }
  });

  it("keeps the sigungu candidate for 서울 성동구 성수동", () => {
    const r = normalizeRegion("서울 성동구 성수동");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.candidates.map((c) => c.code)).toContain("11200");
  });
});

describe("normalizeRegion 안전한 실패", () => {
  it("never throws and returns unknown for bad input", () => {
    for (const v of ["", "   ", "가".repeat(2001), "없는지역이름"]) {
      const r = normalizeRegion(v);
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.reason).toBe("unknown");
      expect(r.message).not.toBe("");
    }
  });

  it("states the 100-character limit for over-long input", () => {
    const r = normalizeRegion("가".repeat(2001));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain("100자");
  });
});

describe("regionField 스키마 헬퍼", () => {
  it("describes the field with examples and the dong restriction", () => {
    const desc = regionField().description ?? "";
    expect(desc).toContain("성동구");
    expect(desc).toContain("수원시 영통구");
    expect(desc).toContain("동 단위");
  });

  it("rejects over-long input and trims valid input", () => {
    expect(regionField().safeParse("가".repeat(41)).success).toBe(false);
    const ok = regionField().safeParse(" 성동구 ");
    expect(ok.success && ok.data).toBe("성동구");
  });

  it("exposes the default field doc", () => {
    expect(REGION_FIELD_DOC.example).toBe("성동구, 수원시 영통구");
  });
});

describe("nemcQuery", () => {
  it("uses nemc_q0/nemc_q1 from regions.json", () => {
    const r = normalizeRegion("성동구");
    expect(r.ok && nemcQuery(r.region)).toEqual({ Q0: "서울특별시", Q1: "성동구" });
  });

  it("follows data for 일반구", () => {
    const r = normalizeRegion("수원시 영통구");
    const g = loadData("regions").sigungu.find((x) => x.code === "41117")!;
    expect(r.ok && nemcQuery(r.region)?.Q1).toBe(g.nemc_q1);
  });

  it("returns only Q0 for sido-only input", () => {
    const r = normalizeRegion("서울");
    const q = r.ok ? nemcQuery(r.region) : undefined;
    expect(q).toEqual({ Q0: "서울특별시" });
    expect(q?.Q1).toBeUndefined();
  });

  it("returns undefined for unknown sido", () => {
    expect(nemcQuery({ sido: "없는도" })).toBeUndefined();
  });
});
