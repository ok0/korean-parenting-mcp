import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonthsClamp,
  compare,
  daysBetween,
  dayOfWeek,
  formatDate,
  fromEpochDay,
  isLeapYear,
  lastDayOfMonth,
  parseDate,
  toEpochDay,
  tryParseDate,
  todayKst,
} from "../src/date/civil-date.js";

describe("parsing", () => {
  it("rejects invalid or malformed dates", () => {
    expect(() => parseDate("2026-02-29")).toThrow(RangeError);
    expect(() => parseDate("2026-04-31")).toThrow(RangeError);
    expect(() => parseDate("2026-13-01")).toThrow(RangeError);
    expect(() => parseDate("2026-9-1")).toThrow(RangeError);
    expect(tryParseDate("2026-02-29")).toBeUndefined();
  });

  it("accepts the three supported formats", () => {
    expect(parseDate("2026-09-26")).toEqual({ y: 2026, m: 9, d: 26 });
    expect(parseDate("2026.09.26")).toEqual({ y: 2026, m: 9, d: 26 });
    expect(parseDate("20260926")).toEqual({ y: 2026, m: 9, d: 26 });
    expect(formatDate(parseDate(" 2028-02-29 "))).toBe("2028-02-29");
  });
});

describe("calendar helpers", () => {
  it("computes leap years and month lengths", () => {
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(2026)).toBe(false);
    expect(isLeapYear(2028)).toBe(true);
    expect(lastDayOfMonth(2026, 2)).toBe(28);
    expect(lastDayOfMonth(2028, 2)).toBe(29);
    expect(lastDayOfMonth(2026, 4)).toBe(30);
  });

  it("clamps month arithmetic to the end of the target month", () => {
    const cases: [string, number, string][] = [
      ["2026-01-31", 1, "2026-02-28"],
      ["2028-01-31", 1, "2028-02-29"],
      ["2026-11-30", 3, "2027-02-28"],
      ["2026-03-31", -1, "2026-02-28"],
      ["2026-12-15", 1, "2027-01-15"],
    ];
    for (const [from, n, to] of cases) {
      expect(formatDate(addMonthsClamp(parseDate(from), n))).toBe(to);
    }
  });

  it("adds days across month, year and leap boundaries", () => {
    const cases: [string, number, string][] = [
      ["2026-12-31", 1, "2027-01-01"],
      ["2026-03-01", -1, "2026-02-28"],
      ["2028-02-28", 1, "2028-02-29"],
      ["2026-01-10", 59, "2026-03-10"],
    ];
    for (const [from, n, to] of cases) {
      expect(formatDate(addDays(parseDate(from), n))).toBe(to);
    }
  });

  it("counts days between dates", () => {
    expect(daysBetween(parseDate("2026-01-01"), parseDate("2027-01-01"))).toBe(365);
    expect(daysBetween(parseDate("2028-01-01"), parseDate("2029-01-01"))).toBe(366);
    expect(daysBetween(parseDate("2026-12-31"), parseDate("2026-12-01"))).toBe(-30);
  });

  it("compares dates", () => {
    expect(compare(parseDate("2026-01-01"), parseDate("2026-01-02"))).toBe(-1);
    expect(compare(parseDate("2026-01-02"), parseDate("2026-01-02"))).toBe(0);
    expect(compare(parseDate("2026-01-03"), parseDate("2026-01-02"))).toBe(1);
  });

  it("computes day of week with 0 as Sunday", () => {
    expect(dayOfWeek(parseDate("2026-09-26"))).toBe(6);
    expect(dayOfWeek(parseDate("2026-01-01"))).toBe(4);
    expect(dayOfWeek(parseDate("2026-03-01"))).toBe(0);
    expect(dayOfWeek(parseDate("1970-01-01"))).toBe(4);
    expect(dayOfWeek(parseDate("2000-02-29"))).toBe(2);
  });

  it("round-trips epoch days", () => {
    for (const s of ["1900-03-01", "2000-02-29", "2026-10-28", "2099-12-31"]) {
      const x = parseDate(s);
      expect(fromEpochDay(toEpochDay(x))).toEqual(x);
    }
    expect(toEpochDay(parseDate("1970-01-01"))).toBe(0);
  });
});

describe("todayKst", () => {
  it("uses the Seoul calendar date regardless of the clock instant", () => {
    expect(formatDate(todayKst({ now: () => new Date("2026-12-31T16:00:00Z") }))).toBe("2027-01-01");
    expect(formatDate(todayKst({ now: () => new Date("2026-12-31T14:59:59Z") }))).toBe("2026-12-31");
  });

  it("gives the same result under different process time zones", () => {
    const prev = process.env.TZ;
    try {
      const results: string[] = [];
      for (const tz of ["America/Los_Angeles", "UTC", "Pacific/Kiritimati"]) {
        process.env.TZ = tz;
        results.push(formatDate(todayKst({ now: () => new Date("2026-12-31T16:00:00Z") })));
        results.push(formatDate(todayKst({ now: () => new Date("2026-12-31T14:59:59Z") })));
      }
      expect(results).toEqual(["2027-01-01", "2026-12-31", "2027-01-01", "2026-12-31", "2027-01-01", "2026-12-31"]);
    } finally {
      if (prev === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = prev;
      }
    }
  });
});
