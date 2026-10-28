import { describe, expect, it } from "vitest";
import { addDays, daysBetween, formatDate, parseDate, type CivilDate } from "../src/date/civil-date.js";
import { bundledCalendar } from "../src/date/holiday-calendar.js";
import { buildTimeline } from "../src/timeline/engine.js";
import { renderItemLine } from "../src/timeline/render.js";
import { ESTIMATED_NOTE } from "../src/tools/shared/format.js";
import { lmpFromDue, prenatalItems } from "../src/timeline/rules/prenatal.js";

const cal = bundledCalendar();

function range(id: string, items: { id: string; start: CivilDate; end?: CivilDate }[]): string {
  const it = items.find((x) => x.id === id);
  if (it === undefined) throw new Error(`항목 없음: ${id}`);
  return `${formatDate(it.start)}~${formatDate(it.end ?? it.start)}`;
}

describe("prenatal checkup items", () => {
  it("due 2027-01-01 intervals", () => {
    const due = parseDate("2027-01-01");
    expect(formatDate(lmpFromDue(due))).toBe("2026-03-27");
    const items = prenatalItems(due);
    expect(items).toHaveLength(3);
    expect(range("prenatal-checkup-1", items)).toBe("2026-03-27~2026-10-15");
    expect(range("prenatal-checkup-2", items)).toBe("2026-10-16~2026-12-10");
    expect(range("prenatal-checkup-3", items)).toBe("2026-12-11~2027-01-01");
    expect(items[0]?.title).toContain("4주마다");
    expect(items[1]?.title).toContain("2주마다");
    expect(items[2]?.title).toContain("매주");
  });

  it("rendered lines carry cycle, high-risk, estimate, partial", () => {
    const items = prenatalItems(parseDate("2027-01-01"));
    for (const it of items) {
      const line = renderItemLine({ ...it, status: "예정" });
      expect(line).toContain("권장 주기");
      expect(line).toContain("만 35세 이상");
      expect(line).toContain("다태아");
      expect(line).toContain(ESTIMATED_NOTE);
      expect(line).toContain("부분 검증");
      expect(it.estimated).toBe(true);
      expect(it.nature).toBe("권장");
      expect(it.category).toBe("검진");
    }
  });

  it("intervals stay contiguous for other due dates", () => {
    for (const dueText of ["2027-01-01", "2028-03-01", "2028-02-29", "2026-12-31"]) {
      const due = parseDate(dueText);
      const lmp = lmpFromDue(due);
      const items = prenatalItems(due);
      expect(items[0]?.start).toEqual(lmp);
      for (let i = 1; i < items.length; i++) {
        const prev = items[i - 1];
        const next = items[i];
        if (prev?.end === undefined || next === undefined) throw new Error("구간 누락");
        expect(daysBetween(prev.end, next.start)).toBe(1);
      }
      const last = items[items.length - 1];
      expect(last?.end).toEqual(due);
      expect(items[1]?.start).toEqual(addDays(lmp, 203));
      expect(items[0]?.end).toEqual(addDays(lmp, 202));
      expect(items[1]?.end).toEqual(addDays(lmp, 258));
    }
  });

  it("prenatal items are not in the default timeline", () => {
    const result = buildTimeline({
      birthDate: parseDate("2026-01-31"),
      referenceDate: parseDate("2026-02-01"),
      monthsAhead: 156,
      includePast: true,
      holidays: cal,
    });
    expect(result.basisIds).not.toContain("mch-act-rule-annex1");
    expect(result.items.some((it) => it.id.startsWith("prenatal-"))).toBe(false);
  });
});
