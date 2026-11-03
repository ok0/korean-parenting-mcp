import { loadData } from "../data-store/load.js";
import { normalizeRegion, type Region } from "./normalize.js";

export type GuMode = "parent" | "full";

// M56 decision (c), call 8 code 40
export const LCGV_GU_MODE: GuMode = "parent";

export const WELFARE_NAMES_AS_OF = "2026-11-03";

export const WELFARE_NAME_OVERRIDES: Readonly<Record<string, { sggNm: string; reason: string }>> = {};

export interface WelfareRegionParams {
  ctpvNm: string;
  sggNm?: string;
  label: string;
  sidoOnly: boolean;
}

export type WelfareRegionResult =
  | { ok: true; params: WelfareRegionParams }
  | {
      ok: false;
      reason: "region" | "unknown-sido" | "no-hierarchy";
      message: string;
      candidates: string[];
    };

export const MSG_UNKNOWN_SIDO = "시도 이름을 확인하지 못했어요. 시도와 시군구 이름을 다시 확인해 주세요.";
export const MSG_NO_HIERARCHY = "시군구 정보를 확인하지 못했어요. 시군구 이름을 다시 확인해 주세요.";

export function welfareNamesBasis(): { asOf: string; regionsAsOf: string; sources: readonly unknown[] } {
  const data = loadData("regions");
  return { asOf: WELFARE_NAMES_AS_OF, regionsAsOf: data.as_of, sources: data.sources };
}

export function welfareRegionParams(
  region: Region,
  mode: GuMode = LCGV_GU_MODE,
  overrides: Readonly<Record<string, { sggNm: string; reason: string }>> = WELFARE_NAME_OVERRIDES,
): WelfareRegionResult {
  const data = loadData("regions");

  const sido = data.sido.find((s) => s.name === region.sido);
  if (!sido) {
    return { ok: false, reason: "unknown-sido", message: MSG_UNKNOWN_SIDO, candidates: [] };
  }

  if (region.sigungu === undefined) {
    return { ok: true, params: { ctpvNm: sido.name, label: sido.name, sidoOnly: true } };
  }

  const entry = region.code
    ? data.sigungu.find((g) => g.code === region.code && g.sido_code === sido.code)
    : undefined;
  if (!entry) {
    return { ok: false, reason: "no-hierarchy", message: MSG_NO_HIERARCHY, candidates: [] };
  }

  if (data.sigungu.filter((g) => g.sido_code === sido.code).length === 1) {
    return { ok: true, params: { ctpvNm: sido.name, label: sido.name, sidoOnly: true } };
  }

  let sggNm: string;
  if (Object.prototype.hasOwnProperty.call(overrides, entry.code)) {
    const ov = overrides[entry.code];
    if (!ov) {
      return { ok: false, reason: "no-hierarchy", message: MSG_NO_HIERARCHY, candidates: [] };
    }
    sggNm = ov.sggNm;
  } else if (entry.parent_code) {
    const parent = data.sigungu.find((g) => g.code === entry.parent_code);
    if (!parent) {
      return { ok: false, reason: "no-hierarchy", message: MSG_NO_HIERARCHY, candidates: [] };
    }
    sggNm = mode === "parent" ? parent.name : entry.name;
  } else {
    sggNm = entry.name;
  }

  return {
    ok: true,
    params: {
      ctpvNm: sido.name,
      sggNm,
      label: `${sido.name} ${entry.name}`,
      sidoOnly: false,
    },
  };
}

export function welfareRegionFromText(input: string): WelfareRegionResult {
  const r = normalizeRegion(input);
  if (!r.ok) {
    return {
      ok: false,
      reason: "region",
      message: r.message,
      candidates: r.candidates.map((c) => [c.sido, c.sigungu].filter(Boolean).join(" ")),
    };
  }
  return welfareRegionParams(r.region);
}
