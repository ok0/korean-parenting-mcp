import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadData } from "../src/data-store/load.js";
import {
  compareCenters,
  HEALTH_CENTER_BASIS_ID,
  HealthCentersSchema,
  type HealthCenterEntry,
  type HealthCentersFile,
} from "../src/data-store/schema.js";
import {
  HEALTH_CENTER_PREPARING,
  HEALTH_CENTER_UNRESOLVED_LINKS,
  healthCenterNotice,
} from "../src/core/notice.js";
import {
  healthCenterLine,
  HEALTH_CENTER_MULTIPLE,
  HEALTH_CENTER_REGION_HINT,
  HEALTH_CENTER_SIDO_ONLY,
  lookupHealthCenter,
  lookupHealthCenterByRegion,
  type HealthCenterLookup,
} from "../src/region/health-centers.js";
import { SOURCE_PROFILES } from "../scripts/lib/health-centers-csv.js";
import { HEALTH_CENTER_CORRECTIONS } from "../scripts/lib/health-center-corrections.js";
import { scanNegativeWording } from "./helpers/affiliation-wording.js";

const PRIMARY_KINDS: readonly string[] = ["보건소", "보건의료원"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const M64_SAMPLE: readonly string[] = [
  "11440|마포구보건소",
  "12790|해남군보건소",
  "48120|창원시 마산보건소",
  "48120|창원시 진해보건소",
  "48120|창원시 창원보건소",
  "51110|춘천시보건소",
  "52110|전주시 보건소",
  "52113|덕진보건소",
];
const M64_FALSE = ["11440|마포구보건소", "12790|해남군보건소"];
const CORRECTED: readonly string[] = HEALTH_CENTER_CORRECTIONS.map((c) => `${c.code}|${c.name}`);

const hc = loadData("health-centers");
const regions = loadData("regions");
const sidoNameByCode = new Map(regions.sido.map((s) => [s.code, s.name]));
const sigunguByCode = new Map(regions.sigungu.map((g) => [g.code, g]));
const childrenOf = (code: string): string[] =>
  regions.sigungu.filter((g) => g.parent_code === code).map((g) => g.code);
const primaryCodes = new Set(hc.centers.filter((c) => PRIMARY_KINDS.includes(c.kind)).map((c) => c.code));
const anyCodes = new Set(hc.centers.map((c) => c.code));

const sc = (
  code: string,
  name: string,
  kind: HealthCenterEntry["kind"] = "보건소",
  extra: Partial<HealthCenterEntry> = {},
): HealthCenterEntry => ({ code, name, kind, verified: "partial", ...extra });

function synth(centers: HealthCenterEntry[]): HealthCentersFile {
  return HealthCentersSchema.parse({
    ...hc,
    note: undefined,
    counts: { ...hc.counts, kept: centers.length },
    centers: [...centers].sort(compareCenters),
  });
}

const L = {
  seongdong: synth([sc("11200", "합성A보건소", "보건소", { phone: "02-0000-0001" })]),
  pyeongtaek: synth([sc("41220", "합성B보건소"), sc("41220", "합성A보건소")]),
  suwonParent: synth([sc("41110", "합성A보건소")]),
  damyang: synth([
    sc("12710", "합성D지소", "보건지소"),
    sc("12710", "합성A지소", "보건지소"),
    sc("12710", "합성B지소", "보건지소"),
    sc("12710", "합성C지소", "보건지소"),
  ]),
  suwonMulti: synth([sc("41111", "합성A보건소"), sc("41113", "합성B보건소")]),
  sejong: synth([sc("36110", "합성A보건소")]),
  noSeongdong: synth([sc("11110", "합성A보건소")]),
};

const coveredCount = regions.sigungu.filter(
  (g) =>
    primaryCodes.has(g.code) ||
    (g.parent_code !== undefined && primaryCodes.has(g.parent_code)) ||
    childrenOf(g.code).some((k) => primaryCodes.has(k)),
).length;

const SYNTH_LOOKUPS: [string, HealthCentersFile][] = [
  ["성동구", L.seongdong],
  ["평택", L.pyeongtaek],
  ["수원시 장안구", L.suwonParent],
  ["담양군", L.damyang],
  ["수원시", L.suwonMulti],
  ["서울", hc],
  ["세종", L.sejong],
  ["아무데나동", hc],
  ["", hc],
  ["성동구", L.noSeongdong],
];

function textsOf(result: HealthCenterLookup): string[] {
  if (result.kind === "unresolved") return [result.message, ...result.candidates];
  return [result.label, ...result.centers.map((c) => healthCenterLine(c))];
}

describe("health-centers", () => {
  beforeAll(() =>
    vi.stubGlobal("fetch", () => {
      throw new Error("global fetch disabled");
    }),
  );
  afterAll(() => vi.unstubAllGlobals());

  describe("bundled list provenance", () => {
    it("file and every entry carry source, date, as_of and a recorded status", () => {
      expect(hc.source.url).toBe(SOURCE_PROFILES[hc.source.dataset_id].source.url);
      expect(hc.source.license).toMatch(/공공데이터포털 3072692 페이지 확인 \d{4}-\d{2}-\d{2}\)$/);
      expect(hc.verified).toBe("partial");
      expect(hc.basis_ids).toEqual([HEALTH_CENTER_BASIS_ID]);
      expect(hc.centers.length).toBeGreaterThan(0);
      for (const c of hc.centers) {
        const key = `${c.code}|${c.name}`;
        if (c.verified === "partial") {
          expect(c.verified_by, key).toBeUndefined();
          expect(c.verified_on, key).toBeUndefined();
        } else {
          expect([...M64_SAMPLE, ...CORRECTED], key).toContain(key);
          expect(c.verified_by, key).toMatch(/^agent web check \(.+\)$/);
          expect(c.verified_on, key).toMatch(DATE_RE);
        }
        expect(c.source_date ?? hc.source.source_modified).toMatch(DATE_RE);
      }
    });

    it("M64 sample entries are recorded", () => {
      for (const k of M64_SAMPLE) {
        expect(hc.centers.some((c) => `${c.code}|${c.name}` === k && c.verified !== "partial"), k).toBe(true);
      }
      expect(hc.centers.filter((c) => c.verified === "full").length).toBe(
        6 + CORRECTED.filter((k) => !M64_SAMPLE.includes(k) || M64_FALSE.includes(k)).length,
      );
      expect(hc.centers.filter((c) => c.verified === "false").length).toBe(
        M64_FALSE.filter((k) => !CORRECTED.includes(k)).length,
      );
    });

    it("M65 corrections are in the bundled list", () => {
      for (const c of HEALTH_CENTER_CORRECTIONS) {
        const matches = hc.centers.filter((e) => e.code === c.code && e.name === c.name);
        expect(matches.length, `${c.code}|${c.name}`).toBeGreaterThan(0);
        for (const e of matches) {
          expect(e, `${c.code}|${c.name}`).toMatchObject({
            phone: c.to,
            verified: "full",
            verified_by: c.verified_by,
            verified_on: c.checked_on,
          });
          expect(e.phone, `${c.code}|${c.name}`).not.toBe(c.from);
        }
      }
    });

    it("note states the covered count while coverage is short", () => {
      if (coveredCount < regions.sigungu.length) {
        expect(hc.note).toBe(
          `주 기관 확인 지역 ${coveredCount}/${regions.sigungu.length}곳. 목록에 없는 지역은 안내 링크로 대신해요`,
        );
      } else {
        expect(hc.note).toBeUndefined();
      }
    });
  });

  describe("lookup rules (synthetic list)", () => {
    it("성동구 with a 11200 보건소 gives found/sigungu", () => {
      const r = lookupHealthCenter("성동구", L.seongdong);
      expect(r).toMatchObject({
        kind: "found",
        scope: "sigungu",
        label: "서울특별시 성동구",
        asOf: hc.as_of,
        basisId: "health-center-standard-data",
      });
      expect(r.kind === "found" ? r.centers.map((c) => c.name) : []).toEqual(["합성A보건소"]);
    });

    it("평택 with two 41220 보건소 gives found/sigungu with both in file order", () => {
      const r = lookupHealthCenter("평택", L.pyeongtaek);
      expect(r.kind).toBe("found");
      expect(r.kind === "found" ? r.scope : "").toBe("sigungu");
      expect(r.kind === "found" ? r.centers.map((c) => c.name) : []).toEqual(["합성A보건소", "합성B보건소"]);
    });

    it("수원시 장안구 with only a 41110 보건소 gives found/parent-city", () => {
      const r = lookupHealthCenter("수원시 장안구", L.suwonParent);
      expect(r).toMatchObject({ kind: "found", scope: "parent-city", label: "경기도 수원시" });
    });

    it("담양군 with four 보건지소 gives found/branch with 3 centers", () => {
      const r = lookupHealthCenter("담양군", L.damyang);
      expect(r.kind).toBe("found");
      expect(r.kind === "found" ? r.scope : "").toBe("branch");
      expect(r.kind === "found" ? r.centers.map((c) => c.name) : []).toEqual([
        "합성A지소",
        "합성B지소",
        "합성C지소",
      ]);
    });

    it("수원시 with 보건소 at 41111 and 41113 gives unresolved/multiple with the gu names", () => {
      const r = lookupHealthCenter("수원시", L.suwonMulti);
      const guNames = childrenOf("41110")
        .sort()
        .map((code) => sigunguByCode.get(code)?.name ?? "")
        .slice(0, 5);
      expect(r).toMatchObject({ kind: "unresolved", reason: "multiple", message: HEALTH_CENTER_MULTIPLE });
      expect(r.kind === "unresolved" ? r.candidates : []).toEqual(guNames);
    });

    it("서울 gives unresolved/sido-only", () => {
      expect(lookupHealthCenter("서울", hc)).toMatchObject({
        kind: "unresolved",
        reason: "sido-only",
        message: HEALTH_CENTER_SIDO_ONLY,
      });
    });

    it("세종 with a 36110 보건소 gives found/sigungu", () => {
      const r = lookupHealthCenter("세종", L.sejong);
      expect(r).toMatchObject({ kind: "found", scope: "sigungu" });
    });

    it("아무데나동 and empty input give unresolved/region", () => {
      for (const input of ["아무데나동", ""]) {
        expect(lookupHealthCenter(input, hc)).toMatchObject({
          kind: "unresolved",
          reason: "region",
          message: HEALTH_CENTER_REGION_HINT,
        });
      }
    });

    it("성동구 with a list that lacks 11200 gives unresolved/none with the preparing message", () => {
      const r = lookupHealthCenter("성동구", L.noSeongdong);
      expect(r.kind).toBe("unresolved");
      expect(r.kind === "unresolved" ? r.reason : "").toBe("none");
      expect(r.kind === "unresolved" ? r.message : "").toContain(
        "이 지역 보건소 연락처는 아직 준비 중이에요. 시군구청 누리집에서 확인하세요",
      );
    });
  });

  describe("lookup on the bundled list", () => {
    it("every listed primary code resolves to its own centers", () => {
      for (const code of primaryCodes) {
        const g = sigunguByCode.get(code);
        expect(g, code).toBeDefined();
        if (g === undefined) continue;
        const r = lookupHealthCenterByRegion(
          { sido: sidoNameByCode.get(g.sido_code) ?? "", sigungu: g.name, code },
          hc,
        );
        const expected = hc.centers
          .filter((c) => c.code === code && PRIMARY_KINDS.includes(c.kind))
          .slice(0, 3);
        expect(r).toMatchObject({ kind: "found", scope: "sigungu" });
        expect(r.kind === "found" ? r.centers : []).toEqual(expected);
      }
    });

    it("all 269 sigungu return a value and unlisted areas get the preparing message", () => {
      expect(regions.sigungu.length).toBe(269);
      for (const g of regions.sigungu) {
        const sido = sidoNameByCode.get(g.sido_code) ?? "";
        const run = (): HealthCenterLookup => lookupHealthCenterByRegion({ sido, sigungu: g.name, code: g.code }, hc);
        expect(run, g.code).not.toThrow();
        const r = run();
        expect(["found", "unresolved"], g.code).toContain(r.kind);
        const noEntries =
          !anyCodes.has(g.code) &&
          (g.parent_code === undefined || !anyCodes.has(g.parent_code)) &&
          childrenOf(g.code).every((k) => !anyCodes.has(k));
        if (noEntries) {
          expect(r, g.code).toMatchObject({
            kind: "unresolved",
            reason: "none",
            message: HEALTH_CENTER_PREPARING,
          });
        }
      }
    });
  });

  describe("fixed text", () => {
    it("healthCenterNotice matches the blueprint text", () => {
      expect(healthCenterNotice("2026-11-02")).toBe(
        "보건소 연락처는 공공데이터 목록(기준일 2026-11-02)에서 옮긴 참고용 정보예요. 전화번호와 운영시간은 바뀔 수 있으니 방문 전에 보건소 홈페이지에서 확인하세요. 산전검사 같은 사업 여부와 조건은 보건소에 문의하세요.",
      );
      expect(healthCenterNotice("2026-11-02")).toContain("기준일 2026-11-02");
      expect(HEALTH_CENTER_UNRESOLVED_LINKS).toContain("https://www.bokjiro.go.kr");
      expect(HEALTH_CENTER_UNRESOLVED_LINKS).toContain("https://www.gov.kr");
    });

    it("healthCenterLine joins only present fields", () => {
      const full = sc("11200", "합성A보건소", "보건소", {
        phone: "02-0000-0001",
        homepage: "https://example.org",
      });
      expect(healthCenterLine(full)).toBe("합성A보건소 · 전화 02-0000-0001 · 홈페이지 https://example.org");
      expect(healthCenterLine(sc("11200", "합성A보건소", "보건소", { homepage: "https://example.org" }))).toBe(
        "합성A보건소 · 홈페이지 https://example.org",
      );
      expect(healthCenterLine(sc("11200", "합성A보건소"))).toBe("합성A보건소");
    });

    it("every bundled center line starts with its name and shows the phone only when set", () => {
      for (const c of hc.centers) {
        const line = healthCenterLine(c);
        expect(line.startsWith(c.name)).toBe(true);
        expect(line.includes(`전화 ${c.phone}`)).toBe(c.phone !== undefined);
      }
    });

    it("no negative or affiliation wording in lookup output", () => {
      const texts: string[] = [
        healthCenterNotice(hc.as_of),
        HEALTH_CENTER_UNRESOLVED_LINKS,
        HEALTH_CENTER_PREPARING,
        HEALTH_CENTER_REGION_HINT,
        HEALTH_CENTER_SIDO_ONLY,
        HEALTH_CENTER_MULTIPLE,
      ];
      for (const g of regions.sigungu) {
        const sido = sidoNameByCode.get(g.sido_code) ?? "";
        texts.push(...textsOf(lookupHealthCenterByRegion({ sido, sigungu: g.name, code: g.code }, hc)));
      }
      for (const [input, list] of SYNTH_LOOKUPS) {
        texts.push(...textsOf(lookupHealthCenter(input, list)));
      }
      for (const t of texts) {
        expect(scanNegativeWording(t).violations, t).toEqual([]);
      }
    });
  });
});
