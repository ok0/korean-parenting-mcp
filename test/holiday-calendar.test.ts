import { describe, expect, it } from "vitest";
import { addDays, parseDate } from "../src/date/civil-date.js";
import { checkHolidaySanity } from "../src/date/holiday-sanity.js";
import { bundledCalendar, createCalendar } from "../src/date/holiday-calendar.js";
import { loadData } from "../src/data-store/load.js";

const RESEARCH_2026 = [
  "2026-01-01",
  "2026-02-16",
  "2026-02-17",
  "2026-02-18",
  "2026-03-01",
  "2026-03-02",
  "2026-05-01",
  "2026-05-05",
  "2026-05-24",
  "2026-05-25",
  "2026-06-03",
  "2026-06-06",
  "2026-07-17",
  "2026-08-15",
  "2026-08-17",
  "2026-09-24",
  "2026-09-25",
  "2026-09-26",
  "2026-10-03",
  "2026-10-05",
  "2026-10-09",
  "2026-12-25",
];

const RESEARCH_2027 = [
  "2027-01-01",
  "2027-02-06",
  "2027-02-07",
  "2027-02-08",
  "2027-02-09",
  "2027-03-01",
  "2027-05-01",
  "2027-05-03",
  "2027-05-05",
  "2027-05-13",
  "2027-06-06",
  "2027-07-17",
  "2027-07-19",
  "2027-08-15",
  "2027-08-16",
  "2027-09-14",
  "2027-09-15",
  "2027-09-16",
  "2027-10-03",
  "2027-10-04",
  "2027-10-09",
  "2027-10-11",
  "2027-12-25",
  "2027-12-27",
];

describe("bundled holiday baseline", () => {
  it("marks every research date as a public holiday", () => {
    const calendar = bundledCalendar();
    for (const x of [...RESEARCH_2026, ...RESEARCH_2027]) {
      expect(calendar.isPublicHoliday(parseDate(x))).toBe(true);
    }
  });

  it("does not mark non-holiday dates as public holidays", () => {
    const calendar = bundledCalendar();
    for (const x of ["2026-06-08", "2027-06-07", "2026-05-26", "2026-09-27"]) {
      expect(calendar.isPublicHoliday(parseDate(x))).toBe(false);
    }
  });

  it("treats a Sunday that is not a holiday as a non-working day only", () => {
    const calendar = bundledCalendar();
    expect(calendar.isPublicHoliday(parseDate("2026-09-27"))).toBe(false);
    expect(calendar.isNonWorkingDay(parseDate("2026-09-27"))).toBe(true);
  });

  it("includes the memorial day in both years", () => {
    const calendar = bundledCalendar();
    expect(calendar.isPublicHoliday(parseDate("2026-06-06"))).toBe(true);
    expect(calendar.isPublicHoliday(parseDate("2027-06-06"))).toBe(true);
  });

  it("passes the sanity check for both bundled years", () => {
    const data = loadData("holidays");
    expect(checkHolidaySanity(2026, data.years["2026"] ?? []).ok).toBe(true);
    expect(checkHolidaySanity(2027, data.years["2027"] ?? []).ok).toBe(true);
  });

  it("matches covers_years with the years that pass the sanity check", () => {
    const data = loadData("holidays");
    const passing = Object.keys(data.years)
      .map(Number)
      .filter((y) => checkHolidaySanity(y, data.years[String(y)] ?? []).ok)
      .sort();
    expect(passing).toEqual([...data.covers_years].sort());
  });

  it("is a manual-research dataset", () => {
    expect(loadData("holidays").source).toBe("manual-research");
  });
});

describe("stale bundle note", () => {
  const gen = parseDate(loadData("holidays").generated_at);

  it("is added at +180 days from the generated date", () => {
    const notes = bundledCalendar({ referenceDate: addDays(gen, 180) }).notes;
    expect(notes.some((n) => n.includes("임시공휴일"))).toBe(true);
  });

  it("is not added at +179 days", () => {
    const notes = bundledCalendar({ referenceDate: addDays(gen, 179) }).notes;
    expect(notes.some((n) => n.includes("임시공휴일"))).toBe(false);
  });

  it("adds no notes for covered years within range", () => {
    expect(bundledCalendar({ years: [2026, 2027], referenceDate: parseDate("2026-11-01") }).notes).toEqual([]);
  });
});

describe("uncovered year handling", () => {
  it("adds one note per uncovered year, deduplicated", () => {
    const calendar = bundledCalendar({ years: [2028, 2026, 2028] });
    expect(calendar.notes).toHaveLength(1);
    expect(calendar.notes[0]).toContain("2028년 공휴일 정보 없음");
  });

  it("reports coverage per year and treats uncovered dates as non-holidays", () => {
    const calendar = bundledCalendar({ years: [2028, 2026, 2028] });
    expect(calendar.coverage(2028)).toBe("none");
    expect(calendar.coverage(2026)).toBe("bundled");
    expect(calendar.isPublicHoliday(parseDate("2028-01-01"))).toBe(false);
  });

  it("produces identical notes for identical options", () => {
    const opts = { years: [2029, 2026], referenceDate: parseDate("2027-06-01") };
    expect(bundledCalendar(opts).notes).toEqual(bundledCalendar(opts).notes);
  });
});

describe("createCalendar injection", () => {
  it("uses injected entries, source and notes", () => {
    const calendar = createCalendar(
      { 2030: { source: "live", entries: [{ date: "2030-03-04", name: "임시" }] } },
      ["x"],
    );
    expect(calendar.isPublicHoliday(parseDate("2030-03-04"))).toBe(true);
    expect(calendar.coverage(2030)).toBe("live");
    expect(calendar.notes).toEqual(["x"]);
  });
});
