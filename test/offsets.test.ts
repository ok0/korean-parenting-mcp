import { describe, expect, it } from "vitest";
import { formatDate, parseDate } from "../src/date/civil-date.js";
import { applyOffset, offsetRange } from "../src/date/offsets.js";

describe("applyOffset", () => {
  it("applies month offsets with end-of-month clamping", () => {
    expect(formatDate(applyOffset(parseDate("2026-01-31"), { months: 1 }))).toBe("2026-02-28");
    expect(formatDate(applyOffset(parseDate("2026-01-31"), { months: 1, days: 0 }))).toBe("2026-02-28");
  });

  it("applies month then day offsets", () => {
    expect(formatDate(applyOffset(parseDate("2026-01-31"), { months: 4, days: 35 }))).toBe("2026-07-05");
    expect(formatDate(applyOffset(parseDate("2026-05-10"), { days: 14 }))).toBe("2026-05-24");
    expect(formatDate(applyOffset(parseDate("2026-05-10"), {}))).toBe("2026-05-10");
  });

  it("applies year offsets with leap-day clamping", () => {
    expect(formatDate(applyOffset(parseDate("2028-02-29"), { years: 1 }))).toBe("2029-02-28");
    expect(formatDate(applyOffset(parseDate("2028-02-29"), { years: 4 }))).toBe("2032-02-29");
  });

  it("offsetRange months, years and days", () => {
    const r = (from: Parameters<typeof offsetRange>[1], to: Parameters<typeof offsetRange>[2]) => {
      const x = offsetRange(parseDate("2026-01-31"), from, to);
      return [formatDate(x.start), formatDate(x.end)];
    };
    expect(r({ months: 15 }, { months: 18 })).toEqual(["2027-04-30", "2027-08-30"]);
    expect(r({ years: 4 }, { years: 6 })).toEqual(["2030-01-31", "2032-01-30"]);
    expect(r({ days: 0 }, { days: 28 })).toEqual(["2026-01-31", "2026-02-28"]);
    expect(r({ days: 0 }, { days: 0 })).toEqual(["2026-01-31", "2026-01-31"]);
    expect(r({ years: 12 }, { years: 12 })).toEqual(["2038-01-31", "2039-01-30"]);
  });

  it("offsetRange leap day", () => {
    const r = (from: Parameters<typeof offsetRange>[1], to: Parameters<typeof offsetRange>[2]) => {
      const x = offsetRange(parseDate("2028-02-29"), from, to);
      return [formatDate(x.start), formatDate(x.end)];
    };
    expect(r({ months: 12 }, { months: 15 })).toEqual(["2029-02-28", "2029-06-28"]);
    expect(r({ years: 4 }, { years: 6 })).toEqual(["2032-02-29", "2034-02-27"]);
  });

  it("offsetRange matches guideline p.110 examples", () => {
    const b = parseDate("2026-04-25");
    expect(formatDate(offsetRange(b, { days: 0 }, { days: 27 }).end)).toBe("2026-05-22");
    const m = offsetRange(b, { months: 6 }, { months: 6 });
    expect([formatDate(m.start), formatDate(m.end)]).toEqual(["2026-10-25", "2026-11-24"]);
    const y = offsetRange(b, { years: 4 }, { years: 6 });
    expect([formatDate(y.start), formatDate(y.end)]).toEqual(["2030-04-25", "2032-04-24"]);
  });
});
