import { loadData } from "../../src/data-store/load.js";
import type { HealthCenterEntry, HealthCentersFile, SigunguEntry } from "../../src/data-store/schema.js";
import { lookupHealthCenter, type HealthCenterLookup } from "../../src/region/health-centers.js";

export const BUNDLED: HealthCentersFile = loadData("health-centers");

export function regionText(g: SigunguEntry): string {
  const sidoName = loadData("regions").sido.find((s) => s.code === g.sido_code)!.name;
  return `${sidoName} ${g.name}`;
}

export function pickRegion(
  pred: (l: HealthCenterLookup, g: SigunguEntry) => boolean,
  data: HealthCentersFile = BUNDLED,
): { text: string; sgg: SigunguEntry; lookup: HealthCenterLookup } | undefined {
  for (const g of loadData("regions").sigungu) {
    const text = regionText(g);
    const l = lookupHealthCenter(text, data);
    if (pred(l, g)) return { text, sgg: g, lookup: l };
  }
  return undefined;
}

export function syntheticFile(centers: HealthCenterEntry[]): HealthCentersFile {
  return { ...BUNDLED, counts: { ...BUNDLED.counts, kept: centers.length }, centers };
}

export function fakeCenter(code: string, kind: HealthCenterEntry["kind"], n: number): HealthCenterEntry {
  return {
    code,
    name: `합성${kind}${n}`,
    kind,
    phone: `000-0000-000${n}`,
    homepage: `https://example.invalid/hc${n}`,
    verified: "partial",
  };
}
