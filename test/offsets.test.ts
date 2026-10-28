import { describe, expect, it } from "vitest";
import { formatDate, parseDate } from "../src/date/civil-date.js";
import { applyOffset } from "../src/date/offsets.js";

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
});
