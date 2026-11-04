import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { normalizeRegion, type Region } from "../src/region/normalize.js";
import {
  LCGV_GU_MODE,
  WELFARE_NAME_OVERRIDES,
  WELFARE_NAMES_AS_OF,
  welfareNamesBasis,
  welfareRegionFromText,
  welfareRegionParams,
  type WelfareRegionParams,
} from "../src/region/welfare-names.js";

function p(input: string): WelfareRegionParams {
  const r = welfareRegionFromText(input);
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error(input);
  return r.params;
}

function regionOf(input: string): Region {
  const r = normalizeRegion(input);
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error(input);
  return r.region;
}

describe("welfareRegionParams", () => {
  beforeAll(() => {
    vi.stubGlobal("fetch", () => {
      throw new Error("global fetch disabled");
    });
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("old and short sido names map to current names", () => {
    for (const input of ["전라남도", "전남"]) {
      const r = p(input);
      expect(r.ctpvNm).toBe("전남광주통합특별시");
      expect(r.sidoOnly).toBe(true);
      expect(r.sggNm).toBeUndefined();
    }
    expect(p("강원도").ctpvNm).toBe("강원특별자치도");
    for (const input of ["전라북도", "전북"]) {
      expect(p(input).ctpvNm).toBe("전북특별자치도");
    }
    expect(p("전라남도 해남군")).toMatchObject({ ctpvNm: "전남광주통합특별시", sggNm: "해남군", sidoOnly: false });
    expect(p("전남 해남군")).toMatchObject({ ctpvNm: "전남광주통합특별시", sggNm: "해남군", sidoOnly: false });
  });

  it("seoul mapo form", () => {
    expect(p("서울 마포구")).toEqual({
      ctpvNm: "서울특별시",
      sggNm: "마포구",
      label: "서울특별시 마포구",
      sidoOnly: false,
    });
  });

  it("current names stay", () => {
    expect(p("전남광주통합특별시 해남군")).toEqual(p("전라남도 해남군"));
    expect(p("강원특별자치도").ctpvNm).toBe("강원특별자치도");
  });

  it("sigungu only fills sido", () => {
    expect(p("마포구")).toMatchObject({ ctpvNm: "서울특별시", sggNm: "마포구" });
    expect(p("해남군")).toMatchObject({ ctpvNm: "전남광주통합특별시", sggNm: "해남군" });
  });

  it("general gu parent and full modes", () => {
    const r = regionOf("수원시 장안구");
    expect(r.code).toBe("41111");
    const parent = welfareRegionParams(r, "parent");
    expect(parent).toMatchObject({ ok: true, params: { sggNm: "수원시", label: "경기도 수원시 장안구" } });
    const full = welfareRegionParams(r, "full");
    expect(full).toMatchObject({ ok: true, params: { sggNm: "수원시 장안구" } });
    expect(welfareRegionParams(r)).toEqual(parent);
    expect(LCGV_GU_MODE).toBe("parent");
    expect(p("장안구")).toMatchObject({ sggNm: "수원시" });
  });

  it("sejong is sido only", () => {
    for (const input of ["세종", "세종시", "세종특별자치시"]) {
      const r = p(input);
      expect(r).toMatchObject({ ctpvNm: "세종특별자치시", sidoOnly: true });
      expect(r.sggNm).toBeUndefined();
    }
  });

  it("unknown input is not converted", () => {
    const r = welfareRegionFromText("없는시 없는구");
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unexpected ok");
    expect(r.reason).toBe("region");
    expect(r.message.length).toBeGreaterThan(0);
  });

  it("unknown sido and missing hierarchy", () => {
    const unknownSido = welfareRegionParams({ sido: "없는도" });
    expect(unknownSido).toMatchObject({ ok: false, reason: "unknown-sido" });
    const noCode: Region = { sido: "경기도", sigungu: "장안구" };
    expect(welfareRegionParams(noCode)).toMatchObject({ ok: false, reason: "no-hierarchy" });
  });

  it("overrides apply by code", () => {
    const region = regionOf("서울 마포구");
    const r = welfareRegionParams(region, "parent", { [region.code!]: { sggNm: "마포", reason: "test" } });
    expect(r).toMatchObject({ ok: true, params: { sggNm: "마포" } });
    expect(WELFARE_NAME_OVERRIDES).toEqual({});
  });

  it("basis", () => {
    const basis = welfareNamesBasis();
    expect(basis.asOf).toBe(WELFARE_NAMES_AS_OF);
    expect(WELFARE_NAMES_AS_OF).toBe("2026-11-03");
    expect(basis.regionsAsOf).toBe("2026-11-04");
    expect(basis.sources.length).toBeGreaterThanOrEqual(1);
  });
});
