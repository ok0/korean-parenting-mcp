import { describe, expect, it } from "vitest";
import { DataValidationError, loadData, validateDataset } from "../src/data-store/load.js";

const R = loadData("regions");
const basis = loadData("basis-documents");

const SAMPLES: [string, string, string][] = [
  ["11200", "11", "성동구"],
  ["41117", "41", "수원시 영통구"],
  ["27720", "27", "군위군"],
  ["28125", "28", "제물포구"],
  ["28155", "28", "영종구"],
  ["28177", "28", "미추홀구"],
  ["28185", "28", "연수구"],
  ["28200", "28", "남동구"],
  ["28237", "28", "부평구"],
  ["28245", "28", "계양구"],
  ["28275", "28", "서해구"],
  ["28290", "28", "검단구"],
  ["28710", "28", "강화군"],
  ["28720", "28", "옹진군"],
];

type MutableRegions = {
  sido: Record<string, unknown>[];
  sigungu: Record<string, unknown>[];
  abolished: Record<string, unknown>[];
};

describe("regions file level", () => {
  it("carries as_of, a verified state, and a primary source with provenance", () => {
    expect(R.as_of).toBeTruthy();
    expect(["partial", "false"]).toContain(R.verified);
    expect(R.sources[0]).toHaveProperty("dataset");
    expect(R.sources[0]).toHaveProperty("provider");
    expect(R.sources[0]).toHaveProperty("as_of");
    expect(R.sources.some((s) => s.role === "primary")).toBe(true);
  });
});

describe("regions sample codes (AC9)", () => {
  it.each(SAMPLES)("%s is %s %s with a kindergarten code", (code, sidoCode, name) => {
    const entry = R.sigungu.find((s) => s.code === code);
    expect(entry?.name).toBe(name);
    expect(entry?.sido_code).toBe(sidoCode);
    expect(entry?.codes.kindergarten).toEqual({ sido: sidoCode, sgg: code });
  });
});

describe("regions 2026 reorganization", () => {
  it("names the Bucheon and Hwaseong districts after the 2026 split", () => {
    const names = new Map(R.sigungu.map((s) => [s.code, s.name]));
    expect(names.get("41192")).toBe("부천시 원미구");
    expect(names.get("41194")).toBe("부천시 소사구");
    expect(names.get("41196")).toBe("부천시 오정구");
    expect(names.get("41591")).toBe("화성시 만세구");
    expect(names.get("41593")).toBe("화성시 효행구");
    expect(names.get("41595")).toBe("화성시 병점구");
    expect(names.get("41597")).toBe("화성시 동탄구");
  });

  it("uses the integrated Gwangju-Jeonnam sido name and keeps old names as aliases", () => {
    const names = R.sido.map((s) => s.name);
    expect(names).toContain("전남광주통합특별시");
    expect(names).not.toContain("광주광역시");
    expect(names).not.toContain("전라남도");
    const sido12 = R.sido.find((s) => s.code === "12");
    expect(sido12?.aliases).toContain("광주광역시");
    expect(sido12?.aliases).toContain("전라남도");
  });

  it("omits the abolished codes from current sigungu", () => {
    const codes = new Set(R.sigungu.map((s) => s.code));
    expect(codes.has("28110")).toBe(false);
    expect(codes.has("28140")).toBe(false);
    expect(codes.has("28260")).toBe(false);
  });
});

describe("regions abolished entries", () => {
  it("records Seo-gu of Incheon with its two successors", () => {
    const seogu = R.abolished.find((a) => a.sido_code === "28" && a.name === "서구");
    expect(seogu).toBeDefined();
    expect([...(seogu?.successor_codes ?? [])].sort()).toEqual(["28275", "28290"]);
  });
});

describe("regions invariants", () => {
  it("has well-formed, unique sigungu codes that match their sido prefix", () => {
    const codes = R.sigungu.map((s) => s.code);
    for (const s of R.sigungu) {
      expect(s.code).toMatch(/^\d{5}$/);
      expect(s.code.slice(0, 2)).toBe(s.sido_code);
    }
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("covers at least 250 sigungu", () => {
    expect(R.sigungu.length).toBeGreaterThanOrEqual(250);
  });

  it("nemc_q1 has no spaces (NEMC accepts compact 일반구 names)", () => {
    for (const s of R.sigungu) {
      expect(s.nemc_q1).not.toMatch(/\s/);
    }
    expect(R.sigungu.find((s) => s.code === "41117")?.nemc_q1).toBe("수원시영통구");
  });

  it("marks some entries unverified, and those have no kindergarten code", () => {
    const unverified = R.sigungu.filter((s) => s.verified === "false");
    expect(unverified.length).toBeGreaterThanOrEqual(1);
    for (const s of unverified) {
      expect(s.codes.kindergarten).toBeUndefined();
    }
  });
});

describe("regions schema negatives", () => {
  const fixture = () => structuredClone(R) as unknown as MutableRegions & Record<string, unknown>;

  it("rejects a duplicate sigungu code", () => {
    const x = fixture();
    const first = x.sigungu[0];
    const second = x.sigungu[1];
    if (first && second) second.code = first.code;
    expect(() => validateDataset("regions", x, basis)).toThrow(DataValidationError);
  });

  it("rejects a sigungu code whose first two digits differ from sido_code", () => {
    const x = fixture();
    const first = x.sigungu[0];
    if (first) first.code = "99999";
    expect(() => validateDataset("regions", x, basis)).toThrow(DataValidationError);
  });

  it("rejects a successor code that is not a current sigungu", () => {
    const x = fixture();
    const first = x.abolished[0];
    if (first) first.successor_codes = ["99999"];
    expect(() => validateDataset("regions", x, basis)).toThrow(DataValidationError);
  });

  it("rejects partial verification without a kindergarten code", () => {
    const x = fixture();
    const unverified = x.sigungu.find((s) => s.verified === "false");
    if (unverified) unverified.verified = "partial";
    expect(() => validateDataset("regions", x, basis)).toThrow(DataValidationError);
  });
});
