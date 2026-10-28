import { describe, expect, it } from "vitest";
import { compare, daysBetween, formatDate, parseDate } from "../src/date/civil-date.js";
import { bundledCalendar } from "../src/date/holiday-calendar.js";
import { loadData } from "../src/data-store/load.js";
import { benefitDeadlineRule } from "../src/timeline/rules/benefit-deadlines.js";
import { checkupRule } from "../src/timeline/rules/checkups.js";
import { registrationRule } from "../src/timeline/rules/registration.js";
import type { TimelineInput, TimelineItem } from "../src/timeline/types.js";

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

function one(items: TimelineItem[], id?: string): TimelineItem {
  const found = id === undefined ? items[0] : items.find((it) => it.id === id);
  if (found === undefined) throw new Error(`항목 없음: ${id}`);
  return found;
}

describe("birth registration rule", () => {
  it("birth registration extends past weekend and substitute holiday", () => {
    const item = one(registrationRule(inp("2026-01-31")));
    expect(formatDate(item.end!)).toBe("2026-03-03");
    expect(item.notes.some((n) => n.includes("원래 말일 2026-02-28"))).toBe(true);
    expect(item.nature).toBe("법정 의무");
    expect(item.provenance.verified).toBe("partial");
    expect(item.provenance.basis_ids).toContain("family-registration-act");
    expect(item.notes.some((n) => n.includes("관할 시·구·읍·면"))).toBe(true);
  });

  it("birth registration without extension", () => {
    const item = one(registrationRule(inp("2026-03-10")));
    expect(formatDate(item.end!)).toBe("2026-04-09");
    expect(item.notes.some((n) => n.includes("원래 말일"))).toBe(false);
  });

  it("missing holiday year is noted on the item", () => {
    const last = Math.max(...loadData("holidays").covers_years);
    const item = one(registrationRule(inp(`${last}-12-15`)));
    expect(item.notes.some((n) => n.includes(`${last + 1}년 공휴일 정보 없음`))).toBe(true);
  });
});

describe("benefit deadline rule", () => {
  it("benefit deadlines are separate 60-day items", () => {
    const items = benefitDeadlineRule(inp("2026-01-31"));
    expect(items.map((it) => it.id)).toEqual(["parent-allowance", "child-allowance"]);
    for (const it of items) {
      expect(formatDate(it.start)).toBe("2026-01-31");
      expect(formatDate(it.end!)).toBe("2026-03-31");
      expect(it.nature).toBe("지원 신청");
      expect(it.notes.some((n) => n.includes("원래 말일"))).toBe(false);
      expect(it.notes.some((n) => n.includes("소급"))).toBe(true);
    }
  });

  it("benefit deadline extended over chuseok", () => {
    const items = benefitDeadlineRule(inp("2026-07-29"));
    expect(items).toHaveLength(2);
    for (const it of items) {
      expect(formatDate(it.end!)).toBe("2026-09-28");
      expect(it.notes.some((n) => n.includes("원래 말일 2026-09-26"))).toBe(true);
    }
  });
});

describe("checkup rule", () => {
  function ranges(birth: string): Record<string, string> {
    return Object.fromEntries(
      checkupRule(inp(birth)).map((it) => [it.id, `${formatDate(it.start)}~${formatDate(it.end!)}`]),
    );
  }

  it("checkup ranges for 2026-01-31", () => {
    expect(ranges("2026-01-31")).toEqual({
      "infant-checkup-1": "2026-02-14~2026-03-07",
      "infant-checkup-2": "2026-05-31~2026-08-30",
      "infant-checkup-3": "2026-10-31~2027-02-27",
      "infant-checkup-4": "2027-07-31~2028-02-28",
      "infant-checkup-5": "2028-07-31~2029-02-27",
      "infant-checkup-6": "2029-07-31~2030-02-27",
      "infant-checkup-7": "2030-07-31~2031-02-27",
      "infant-checkup-8": "2031-07-31~2032-01-30",
      "oral-checkup-1": "2027-07-31~2028-07-30",
      "oral-checkup-2": "2028-07-31~2029-07-30",
      "oral-checkup-3": "2029-07-31~2030-07-30",
      "oral-checkup-4": "2030-07-31~2031-07-30",
    });
  });

  it("checkup ranges for 2026-03-10", () => {
    const r = ranges("2026-03-10");
    expect(r["infant-checkup-1"]).toBe("2026-03-24~2026-04-14");
    expect(r["infant-checkup-2"]).toBe("2026-07-10~2026-10-09");
    expect(r["infant-checkup-8"]).toBe("2031-09-10~2032-03-09");
  });

  it("9~12 month round for 2025-08-31", () => {
    expect(ranges("2025-08-31")["infant-checkup-3"]).toBe("2026-05-31~2026-09-29");
  });

  it("rounds do not overlap and oral rounds are contiguous", () => {
    for (const birth of ["2026-01-31", "2026-03-10", "2025-08-31", "2028-02-29"]) {
      const items = checkupRule(inp(birth));
      const infant = items.filter((it) => it.id.startsWith("infant-checkup-"));
      const oral = items.filter((it) => it.id.startsWith("oral-checkup-"));
      expect(infant).toHaveLength(8);
      expect(oral).toHaveLength(4);
      for (let i = 1; i < infant.length; i++) {
        expect(compare(infant[i - 1]!.end!, infant[i]!.start)).toBeLessThan(0);
      }
      for (let i = 1; i < oral.length; i++) {
        const prev = oral[i - 1]!;
        const next = oral[i]!;
        expect(compare(prev.end!, next.start)).toBeLessThan(0);
        expect(daysBetween(prev.end!, next.start)).toBe(1);
      }
    }
  });

  it("checkup titles and nature", () => {
    const items = checkupRule(inp("2026-01-31"));
    const titles = items.map((it) => it.title);
    expect(titles).toContain("영유아 건강검진 1차 (생후 14~35일)");
    expect(titles).toContain("영유아 구강검진 1차 (18~29개월)");
    for (const it of items) {
      expect(it.nature).toBe("권장");
      expect(it.provenance.verified).toBe("partial");
    }
  });
});
