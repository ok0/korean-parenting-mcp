import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  compareKg,
  estimate,
  estimateText,
  latestByKinder,
  roundLabel,
  roundsOf,
  toCount,
  toKgRow,
  vacancy,
  vacancyText,
  type KgRow,
} from "../src/kindergarten/summarize.js";

type Item = Record<string, unknown>;

function items(name: string): Item[] {
  const parsed = JSON.parse(readFileSync(new URL(`./fixtures/kindergarten/${name}`, import.meta.url), "utf8")) as {
    kinderInfo: Item[];
  };
  return parsed.kinderInfo;
}

function item(name: string, key: string): Item {
  const found = items(name).find((x) => x.key === key);
  if (found === undefined) throw new Error(`missing ${name} key ${key}`);
  return found;
}

function rowsOf(name: string): KgRow[] {
  return items(name)
    .map(toKgRow)
    .filter((r): r is KgRow => r !== undefined);
}

function rowOf(name: string, key: string): KgRow {
  const row = toKgRow(item(name, key));
  if (row === undefined) throw new Error(`no row for ${name} key ${key}`);
  return row;
}

describe("toCount", () => {
  it("parses digit strings only", () => {
    expect(toCount("0")).toBe(0);
    expect(toCount(" 12 ")).toBe(12);
    expect(toCount("1,234")).toBe(1234);
    expect(toCount(7)).toBe(7);
  });

  it("treats negative, non-integer, non-numeric and missing values as unknown", () => {
    for (const v of ["-2", "abc", null, "", "1.5", -1, 2.5, undefined]) {
      expect(toCount(v)).toBeUndefined();
    }
  });
});

describe("toKgRow", () => {
  it("reads live field names for basicInfo2 row 1", () => {
    const row = rowOf("basicInfo2.json", "1");
    expect(row.code).toBe("1ecec08c-ed19-b044-e053-0a32095ab044");
    expect(row.rpst).toBe("N");
    expect(row.ages[3]).toEqual({ capacity: 14, enrolled: 13, classes: 1 });
    expect(row.totalCapacity).toBe(52);
    expect(row.totalEnrolled).toBe(36);
    expect(row.homepage).toBe("https://majang.sen.es.kr");
  });

  it("leaves homepage undefined when hpaddr is null", () => {
    expect(rowOf("basicInfo2.json", "5").homepage).toBeUndefined();
  });

  it("reads the alternate spellings and null-safe fields of edge row 1", () => {
    const row = rowOf("edge-values.json", "1");
    expect(row.code).toBe("synthetic-0001");
    expect(row.rpst).toBe("Y");
    expect(row.ages[3].capacity).toBeUndefined();
    expect(row.ages[4].capacity).toBeUndefined();
    expect(row.ages[5].capacity).toBeUndefined();
    expect(row.ages[3].enrolled).toBe(5);
    expect(row.totalCapacity).toBeUndefined();
    expect(row.homepage).toBeUndefined();
  });

  it("leaves null text fields undefined on edge row 4", () => {
    const row = rowOf("edge-values.json", "4");
    expect(row.homepage).toBeUndefined();
    expect(row.establish).toBeUndefined();
    expect(row.addr).toBeUndefined();
    expect(row.tel).toBeUndefined();
  });

  it("drops an item without a name", () => {
    expect(toKgRow(item("edge-values.json", "5"))).toBeUndefined();
  });
});

describe("latestByKinder and rounds", () => {
  it("keeps the newest round per kindergarten", () => {
    const parsed = items("mixed-rounds.json").map(toKgRow).filter((r): r is KgRow => r !== undefined);
    const result = latestByKinder(parsed);
    expect(result.rows).toHaveLength(2);
    expect(result.superseded).toBe(1);
    expect(result.rows[0]?.name).toBe("서울마장초등학교병설유치원");
    expect(result.rows[0]?.round).toBe("20262");
    expect(result.rows[0]?.ages[3].enrolled).toBe(13);
    expect(result.rows[1]?.round).toBe("20242");
    expect(roundsOf(result.rows)).toEqual(["20262", "20242"]);
  });

  it("merges codeless rows with the same name and address", () => {
    const a = toKgRow({ kindername: "X유치원", addr: "A주소", pbnttmng: "20262" });
    const b = toKgRow({ kindername: "X유치원", addr: "A주소", pbnttmng: "20242" });
    if (a === undefined || b === undefined) throw new Error("row missing");
    const result = latestByKinder([a, b]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.round).toBe("20262");
    expect(result.superseded).toBe(1);
  });

  it("labels rounds", () => {
    expect(roundLabel("20262")).toBe("2026년 2차(공시차수 20262)");
    expect(roundLabel(undefined)).toBe("공시 차수 정보 없음");
    expect(roundLabel("2026")).toBe("공시 차수 2026");
  });
});

describe("vacancy and estimate", () => {
  it("handles null, negative and overflow edge cases without assuming zero", () => {
    const ga = rowOf("edge-values.json", "1");
    expect(estimate(ga)).toEqual({ vacancy: { kind: "unknown" }, basis: "total" });
    expect(estimateText(estimate(ga))).toBe("산출 불가(연령별·총정원 정보 없음)");

    const na = rowOf("edge-values.json", "2");
    expect(estimate(na)).toEqual({ vacancy: { kind: "open", seats: 23 }, basis: "total" });
    expect(estimateText(estimate(na))).toBe("총정원 기준 여석 추정 23명(연령별 정원 정보 없음)");

    const da = rowOf("edge-values.json", "3");
    expect(estimate(da)).toEqual({ vacancy: { kind: "full" }, basis: "ageSum" });
    expect(estimateText(estimate(da))).toBe("연령반 합계 정원 충족(여석 없음 추정)");

    const ra = rowOf("edge-values.json", "4");
    expect(estimate(ra)).toEqual({ vacancy: { kind: "open", seats: 3 }, basis: "ageSum" });
    expect(vacancy(0, 0)).toEqual({ kind: "noClass" });
    expect(vacancyText(vacancy(0, 0))).toBe("해당 연령반 없음(공시 정원 0)");
  });

  it("estimates a single age from basicInfo2 row 1", () => {
    expect(estimate(rowOf("basicInfo2.json", "1"), 3)).toEqual({
      vacancy: { kind: "open", seats: 1 },
      basis: "age",
    });
  });
});

describe("compareKg", () => {
  const names = (rows: KgRow[]): string[] => rows.map((r) => r.name);
  const expectedTotal = [
    "서울동명초등학교병설유치원",
    "서울경일초등학교병설유치원",
    "로사유치원",
    "서울금호초등학교병설유치원",
    "서울마장초등학교병설유치원",
  ];
  const expectedAge3 = [
    "서울동명초등학교병설유치원",
    "서울금호초등학교병설유치원",
    "로사유치원",
    "서울마장초등학교병설유치원",
    "서울경일초등학교병설유치원",
  ];

  it("is deterministic for the total basis", () => {
    const rows = rowsOf("basicInfo2.json");
    expect(names([...rows].sort(compareKg()))).toEqual(expectedTotal);
    expect(names([...rows].reverse().sort(compareKg()))).toEqual(expectedTotal);
  });

  it("orders by the age 3 estimate", () => {
    const rows = rowsOf("basicInfo2.json");
    expect(names([...rows].sort(compareKg(3)))).toEqual(expectedAge3);
    expect(names([...rows].reverse().sort(compareKg(3)))).toEqual(expectedAge3);
  });
});
