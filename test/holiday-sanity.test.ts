import { describe, expect, it } from "vitest";
import { checkHolidaySanity, FIXED_SOLAR_HOLIDAYS, type HolidayEntry } from "../src/date/holiday-sanity.js";

const FIXED_2026: HolidayEntry[] = FIXED_SOLAR_HOLIDAYS.map((md) => ({ date: `2026-${md}`, name: "고정" }));
const SEOLLAL_2026: HolidayEntry[] = [
  { date: "2026-02-16", name: "설날 전날" },
  { date: "2026-02-17", name: "설날" },
  { date: "2026-02-18", name: "설날 다음날" },
];

describe("checkHolidaySanity", () => {
  it("passes when all fixed solar holidays are present", () => {
    const entries = [...FIXED_2026, ...SEOLLAL_2026];
    expect(checkHolidaySanity(2026, entries)).toEqual({ ok: true, missing: [] });
  });

  it("reports missing fixed holidays in list order", () => {
    const entries = [...FIXED_2026, ...SEOLLAL_2026].filter(
      (e) => e.date !== "2026-05-01" && e.date !== "2026-07-17",
    );
    expect(checkHolidaySanity(2026, entries)).toEqual({
      ok: false,
      missing: ["2026-05-01", "2026-07-17"],
    });
  });

  it("reports all fixed holidays when the list is empty", () => {
    const result = checkHolidaySanity(2026, []);
    expect(result.ok).toBe(false);
    expect(result.missing.length).toBe(10);
    expect(result.missing[0]).toBe("2026-01-01");
  });
});
