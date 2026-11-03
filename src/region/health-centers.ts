import { loadData } from "../data-store/load.js";
import {
  HEALTH_CENTER_BASIS_ID,
  HEALTH_CENTER_PRIMARY_KINDS,
  type HealthCenterEntry,
  type HealthCentersFile,
  type SigunguEntry,
} from "../data-store/schema.js";
import { HEALTH_CENTER_PREPARING } from "../core/notice.js";
import { normalizeRegion, type Region } from "./normalize.js";

export { HEALTH_CENTER_BASIS_ID };

export const HEALTH_CENTER_MAX_CENTERS = 3;
export const HEALTH_CENTER_MAX_CANDIDATES = 5;
export const HEALTH_CENTER_REGION_HINT = "보건소 연락처는 시군구 이름으로 찾아 드려요. 시도와 시군구를 함께 알려 주세요(예: 서울 성동구, 수원시 영통구).";
export const HEALTH_CENTER_SIDO_ONLY = "보건소 연락처는 시군구별로 정리되어 있어요. 시군구까지 함께 알려 주세요(예: 서울 성동구).";
export const HEALTH_CENTER_MULTIPLE = "이 시는 구마다 보건소가 있어요. 아래 구 이름 중 하나를 함께 알려 주세요.";

export type HealthCenterScope = "sigungu" | "parent-city" | "branch";

export type HealthCenterLookup =
  | {
      kind: "found";
      label: string;
      centers: readonly HealthCenterEntry[];
      scope: HealthCenterScope;
      asOf: string;
      basisId: typeof HEALTH_CENTER_BASIS_ID;
    }
  | {
      kind: "unresolved";
      reason: "region" | "sido-only" | "none" | "multiple";
      message: string;
      candidates: readonly string[];
    };

interface RegionIndex {
  sggByCode: Map<string, SigunguEntry>;
  sidoNameByCode: Map<string, string>;
  sidoCodeByName: Map<string, string>;
  sggBySido: Map<string, SigunguEntry[]>;
  childrenByParent: Map<string, SigunguEntry[]>;
}

let regionMemo: RegionIndex | undefined;

function regionIndex(): RegionIndex {
  if (regionMemo) return regionMemo;
  const data = loadData("regions");
  const sidoNameByCode = new Map<string, string>();
  const sidoCodeByName = new Map<string, string>();
  for (const s of data.sido) {
    sidoNameByCode.set(s.code, s.name);
    sidoCodeByName.set(s.name, s.code);
  }
  const sggByCode = new Map<string, SigunguEntry>();
  const sggBySido = new Map<string, SigunguEntry[]>();
  const childrenByParent = new Map<string, SigunguEntry[]>();
  const sorted = [...data.sigungu].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  for (const g of sorted) {
    sggByCode.set(g.code, g);
    const bySido = sggBySido.get(g.sido_code) ?? [];
    bySido.push(g);
    sggBySido.set(g.sido_code, bySido);
    if (g.parent_code !== undefined) {
      const kids = childrenByParent.get(g.parent_code) ?? [];
      kids.push(g);
      childrenByParent.set(g.parent_code, kids);
    }
  }
  regionMemo = { sggByCode, sidoNameByCode, sidoCodeByName, sggBySido, childrenByParent };
  return regionMemo;
}

interface CenterIndex {
  primaries: Map<string, HealthCenterEntry[]>;
  secondaries: Map<string, HealthCenterEntry[]>;
}

const PRIMARY_KINDS: readonly string[] = HEALTH_CENTER_PRIMARY_KINDS;
const centerMemo = new WeakMap<HealthCentersFile, CenterIndex>();

function centerIndex(data: HealthCentersFile): CenterIndex {
  const cached = centerMemo.get(data);
  if (cached) return cached;
  const primaries = new Map<string, HealthCenterEntry[]>();
  const secondaries = new Map<string, HealthCenterEntry[]>();
  for (const c of data.centers) {
    const target = PRIMARY_KINDS.includes(c.kind) ? primaries : secondaries;
    const list = target.get(c.code) ?? [];
    list.push(c);
    target.set(c.code, list);
  }
  const index: CenterIndex = { primaries, secondaries };
  centerMemo.set(data, index);
  return index;
}

const found = (
  label: string,
  centers: readonly HealthCenterEntry[],
  scope: HealthCenterScope,
  data: HealthCentersFile,
): HealthCenterLookup => ({
  kind: "found",
  label,
  centers: centers.slice(0, HEALTH_CENTER_MAX_CENTERS),
  scope,
  asOf: data.as_of,
  basisId: HEALTH_CENTER_BASIS_ID,
});

const unresolved = (
  reason: "region" | "sido-only" | "none" | "multiple",
  message: string,
  candidates: string[] = [],
): HealthCenterLookup => ({
  kind: "unresolved",
  reason,
  message,
  candidates: candidates.slice(0, HEALTH_CENTER_MAX_CANDIDATES),
});

export function lookupHealthCenter(
  regionText: string,
  data: HealthCentersFile = loadData("health-centers"),
): HealthCenterLookup {
  const r = normalizeRegion(regionText);
  if (!r.ok) {
    return unresolved(
      "region",
      HEALTH_CENTER_REGION_HINT,
      r.candidates.map((c) => (c.sigungu !== undefined ? `${c.sido} ${c.sigungu}` : c.sido)),
    );
  }
  return lookupHealthCenterByRegion(r.region, data);
}

export function lookupHealthCenterByRegion(
  region: Region,
  data: HealthCentersFile = loadData("health-centers"),
): HealthCenterLookup {
  const idx = regionIndex();
  const { primaries, secondaries } = centerIndex(data);

  let code = region.code;
  if (code === undefined) {
    const sidoCode = idx.sidoCodeByName.get(region.sido);
    const list = sidoCode !== undefined ? (idx.sggBySido.get(sidoCode) ?? []) : [];
    const only = list.length === 1 ? list[0] : undefined;
    if (only === undefined) {
      return unresolved("sido-only", HEALTH_CENTER_SIDO_ONLY);
    }
    code = only.code;
  }

  const g = idx.sggByCode.get(code);
  if (g === undefined) {
    return unresolved("none", HEALTH_CENTER_PREPARING);
  }
  const sidoName = idx.sidoNameByCode.get(g.sido_code) ?? region.sido;
  const label = `${sidoName} ${g.name}`;

  const own = primaries.get(code);
  if (own !== undefined && own.length > 0) {
    return found(label, own, "sigungu", data);
  }

  if (g.parent_code !== undefined) {
    const parentCenters = primaries.get(g.parent_code);
    if (parentCenters !== undefined && parentCenters.length > 0) {
      const parentEntry = idx.sggByCode.get(g.parent_code);
      const parentLabel = parentEntry !== undefined ? `${sidoName} ${parentEntry.name}` : label;
      return found(parentLabel, parentCenters, "parent-city", data);
    }
  }

  const branches = secondaries.get(code);
  if (branches !== undefined && branches.length > 0) {
    return found(label, branches, "branch", data);
  }

  const kids = idx.childrenByParent.get(code) ?? [];
  if (kids.some((k) => primaries.has(k.code))) {
    return unresolved("multiple", HEALTH_CENTER_MULTIPLE, kids.map((k) => k.name));
  }

  return unresolved("none", HEALTH_CENTER_PREPARING);
}

export function healthCenterLine(c: HealthCenterEntry): string {
  return [
    c.name,
    c.phone !== undefined ? `전화 ${c.phone}` : undefined,
    c.homepage !== undefined ? `홈페이지 ${c.homepage}` : undefined,
  ]
    .filter((x): x is string => x !== undefined)
    .join(" · ");
}
