import { describe, expect, it } from "vitest";
import { addDays, addMonthsClamp, formatDate, parseDate, type CivilDate } from "../src/date/civil-date.js";
import { bundledCalendar } from "../src/date/holiday-calendar.js";
import type { TimelineInput, TimelineItem } from "../src/timeline/types.js";
import {
  SAME_PERIOD_NOTE,
  UNVERIFIED_NOTE,
  doseItems,
  influenzaItems,
  influenzaNotices,
  pregnancyInfluenzaItems,
  vaccinationRule,
} from "../src/timeline/rules/vaccination.js";

const cal = bundledCalendar();

function inp(birth: string, ref: string = birth): TimelineInput {
  return {
    birthDate: parseDate(birth),
    referenceDate: parseDate(ref),
    monthsAhead: 156,
    includePast: true,
    holidays: cal,
  };
}

function one(items: TimelineItem[], id: string): TimelineItem {
  const found = items.find((it) => it.id === id);
  if (found === undefined) throw new Error(`항목 없음: ${id}`);
  return found;
}

const rng = (it: TimelineItem): string => `${formatDate(it.start)}~${formatDate(it.end ?? it.start)}`;

const SPEC: [string, number, "d" | "m" | "y", number, number][] = [
  ["bcg", 1, "d", 0, 27],
  ["hepb", 1, "d", 0, 0],
  ["hepb", 2, "m", 1, 1],
  ["hepb", 3, "m", 6, 6],
  ["dtap", 1, "m", 2, 2],
  ["dtap", 2, "m", 4, 4],
  ["dtap", 3, "m", 6, 6],
  ["dtap", 4, "m", 15, 18],
  ["dtap", 5, "y", 4, 6],
  ["dtap", 6, "y", 11, 12],
  ["ipv", 1, "m", 2, 2],
  ["ipv", 2, "m", 4, 4],
  ["ipv", 3, "m", 6, 18],
  ["ipv", 4, "y", 4, 6],
  ["hib", 1, "m", 2, 2],
  ["hib", 2, "m", 4, 4],
  ["hib", 3, "m", 6, 6],
  ["hib", 4, "m", 12, 15],
  ["pcv", 1, "m", 2, 2],
  ["pcv", 2, "m", 4, 4],
  ["pcv", 3, "m", 6, 6],
  ["pcv", 4, "m", 12, 15],
  ["rota-rv1", 1, "m", 2, 2],
  ["rota-rv1", 2, "m", 4, 4],
  ["rota-rv5", 1, "m", 2, 2],
  ["rota-rv5", 2, "m", 4, 4],
  ["rota-rv5", 3, "m", 6, 6],
  ["mmr", 1, "m", 12, 15],
  ["mmr", 2, "y", 4, 6],
  ["var", 1, "m", 12, 15],
  ["hepa", 1, "m", 12, 23],
  ["hepa", 2, "m", 18, 18],
  ["je-inactivated", 1, "m", 12, 23],
  ["je-inactivated", 2, "m", 13, 23],
  ["je-inactivated", 3, "m", 24, 35],
  ["je-inactivated", 4, "y", 6, 6],
  ["je-inactivated", 5, "y", 12, 12],
  ["je-live", 1, "m", 12, 23],
  ["je-live", 2, "m", 24, 35],
  ["hpv", 1, "y", 11, 12],
  ["hpv", 2, "y", 11, 12],
];

function expected(birth: CivilDate, unit: "d" | "m" | "y", from: number, to: number) {
  if (unit === "d") return { start: addDays(birth, from), end: addDays(birth, to) };
  if (unit === "m") {
    return { start: addMonthsClamp(birth, from), end: addDays(addMonthsClamp(birth, to + 1), -1) };
  }
  return {
    start: addMonthsClamp(birth, from * 12),
    end: addDays(addMonthsClamp(birth, (from < to ? to : to + 1) * 12), -1),
  };
}

describe("vaccination rules", () => {
  it("every dose follows the R2 rule", () => {
    for (const b of ["2026-01-31", "2028-02-29", "2025-08-31"]) {
      const birth = parseDate(b);
      const items = doseItems(birth);
      expect(new Set(items.map((it) => it.id))).toEqual(
        new Set(SPEC.map(([id, dose]) => `vac-${id}-${dose}`)),
      );
      for (const [id, dose, unit, from, to] of SPEC) {
        const item = one(items, `vac-${id}-${dose}`);
        const e = expected(birth, unit, from, to);
        expect(rng(item)).toBe(`${formatDate(e.start)}~${formatDate(e.end)}`);
      }
    }
  });

  it("2026-01-31 published examples", () => {
    const items = doseItems(parseDate("2026-01-31"));
    const cases: [string, string][] = [
      ["vac-bcg-1", "2026-01-31~2026-02-27"],
      ["vac-hepb-1", "2026-01-31~2026-01-31"],
      ["vac-hepb-2", "2026-02-28~2026-03-30"],
      ["vac-hepb-3", "2026-07-31~2026-08-30"],
      ["vac-dtap-1", "2026-03-31~2026-04-29"],
      ["vac-dtap-2", "2026-05-31~2026-06-29"],
      ["vac-dtap-3", "2026-07-31~2026-08-30"],
      ["vac-dtap-4", "2027-04-30~2027-08-30"],
      ["vac-mmr-1", "2027-01-31~2027-05-30"],
      ["vac-mmr-2", "2030-01-31~2032-01-30"],
      ["vac-hpv-1", "2037-01-31~2038-01-30"],
      ["vac-hpv-2", "2037-01-31~2038-01-30"],
      ["vac-je-inactivated-5", "2038-01-31~2039-01-30"],
      ["vac-dtap-5", "2030-01-31~2032-01-30"],
      ["vac-dtap-6", "2037-01-31~2038-01-30"],
      ["vac-ipv-4", "2030-01-31~2032-01-30"],
      ["vac-je-inactivated-4", "2032-01-31~2033-01-30"],
      ["vac-hepa-2", "2027-07-31~2027-08-30"],
      ["vac-je-inactivated-2", "2027-02-28~2028-01-30"],
    ];
    for (const [id, range] of cases) {
      expect(rng(one(items, id))).toBe(range);
    }
  });

  it("leap day and month-end clamping", () => {
    const leap = doseItems(parseDate("2028-02-29"));
    expect(rng(one(leap, "vac-mmr-1"))).toBe("2029-02-28~2029-06-28");
    expect(rng(one(leap, "vac-mmr-2"))).toBe("2032-02-29~2034-02-27");

    const aug = doseItems(parseDate("2025-08-31"));
    expect(rng(one(aug, "vac-hepb-2"))).toBe("2025-09-30~2025-10-30");
    expect(rng(one(aug, "vac-hepb-3"))).toBe("2026-02-28~2026-03-30");
    expect(rng(one(aug, "vac-dtap-4"))).toBe("2026-11-30~2027-03-30");
  });

  it("titles, category and nature", () => {
    const items = doseItems(parseDate("2026-01-31"));
    expect(one(items, "vac-dtap-6").title).toBe("DTaP 6차 (Tdap/Td, 11~12세)");
    expect(one(items, "vac-hepb-1").title).toBe("B형간염 1차 (출생 시)");
    expect(one(items, "vac-dtap-4").title).toBe("DTaP 4차 (15~18개월)");
    expect(one(items, "vac-je-inactivated-4").title).toBe("일본뇌염 불활성화 백신 4차 (6세)");
    expect(one(items, "vac-rota-rv1-1").title).toBe("로타바이러스 RV1 1차 (2개월)");
    expect(one(items, "vac-hepa-2").title).toBe("A형간염 2차 (18개월)");
    for (const it of items) {
      expect(it.category).toBe("접종");
      expect(it.nature).toBe("권장");
      expect(it.title).not.toContain("|");
    }
  });

  it("verification and memos", () => {
    const items = doseItems(parseDate("2026-01-31"));
    const status: Record<string, string> = { bcg: "full", hepb: "full", dtap: "full", ipv: "full", hib: "full", pcv: "full", "rota-rv1": "full", "rota-rv5": "full", mmr: "full", var: "full", hepa: "full", "je-inactivated": "partial", "je-live": "full", hpv: "false" };
    for (const it of items) {
      const vid = it.id.replace(/^vac-/, "").replace(/-\d+$/, "");
      expect(it.provenance.verified, it.id).toBe(status[vid]);
      if (status[vid] === "false") expect(it.notes, it.id).toContain(UNVERIFIED_NOTE);
      else expect(it.notes, it.id).not.toContain(UNVERIFIED_NOTE);
    }
    expect(one(items, "vac-rota-rv1-1").notes.some((n) => n.includes("택일"))).toBe(true);
    expect(one(items, "vac-je-inactivated-1").notes.some((n) => n.includes("택일"))).toBe(true);
    expect(one(items, "vac-hepa-1").notes).not.toContain(SAME_PERIOD_NOTE);
    expect(one(items, "vac-je-inactivated-1").notes).not.toContain(SAME_PERIOD_NOTE);
    expect(one(items, "vac-hpv-1").notes).toContain(SAME_PERIOD_NOTE);
    expect(one(items, "vac-dtap-1").notes).not.toContain(SAME_PERIOD_NOTE);
    expect(one(items, "vac-je-inactivated-3").notes).not.toContain(SAME_PERIOD_NOTE);
    expect(one(items, "vac-pcv-4").notes.some((n) => n.includes("고위험"))).toBe(true);
    expect(one(items, "vac-rota-rv1-1").notes).toContain("1차는 생후 14주 6일까지, 마지막 차수는 생후 8개월 0일까지 접종합니다(2026 국가예방접종 지침).");
    expect(one(items, "vac-rota-rv5-1").notes).toContain("1차는 생후 14주 6일까지, 마지막 차수는 생후 8개월 0일까지 접종합니다(2026 국가예방접종 지침).");
  });

  it("influenza season by birth date", () => {
    const id = "vac-flu-2026-2027";
    const a = vaccinationRule(inp("2026-01-31"));
    const fa = one(a, id);
    expect(rng(fa)).toBe("2026-09-21~2027-04-30");
    expect(fa.notes.some((n) => n.includes("2회"))).toBe(true);
    const na = influenzaNotices(inp("2026-01-31"));
    expect(na).toHaveLength(1);
    expect(na[0]).toContain("등록된 절기(2026-2027 절기) 이후 정보 없음");

    expect(rng(one(vaccinationRule(inp("2026-05-10")), id))).toBe("2026-11-10~2027-04-30");

    expect(vaccinationRule(inp("2026-12-15")).find((it) => it.id === id)).toBeUndefined();
    expect(influenzaNotices(inp("2026-12-15")).some((n) => n.includes("이후 정보 없음"))).toBe(true);

    const old = vaccinationRule(inp("2012-03-01"));
    const fo = one(old, id);
    expect(rng(fo)).toBe("2026-09-21~2027-02-28");
    expect(fo.notes.some((n) => n.includes("2회"))).toBe(false);
    expect(influenzaNotices(inp("2012-03-01"))).toEqual([]);

    expect(vaccinationRule(inp("2010-01-01")).find((it) => it.id === id)).toBeUndefined();
    expect(influenzaNotices(inp("2010-01-01"))).toEqual([]);
    expect(influenzaItems(parseDate("2010-01-01"))).toEqual([]);
  });

  it("pregnant influenza by due date", () => {
    const a = pregnancyInfluenzaItems(parseDate("2027-06-01"));
    expect(a).toHaveLength(1);
    expect(rng(a[0]!)).toBe("2026-09-21~2027-04-30");
    expect(a[0]!.estimated).toBe(true);
    expect(a[0]!.notes.some((n) => n.includes("임신 주수와 상관없이 1회"))).toBe(true);

    const b = pregnancyInfluenzaItems(parseDate("2026-12-20"));
    expect(rng(b[0]!)).toBe("2026-09-21~2026-12-20");

    expect(pregnancyInfluenzaItems(parseDate("2026-09-01"))).toEqual([]);
  });

  it("deterministic", () => {
    expect(vaccinationRule(inp("2026-01-31"))).toEqual(vaccinationRule(inp("2026-01-31")));
  });
});
