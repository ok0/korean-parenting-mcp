export interface HolidayEntry {
  date: string;
  name: string;
}

// 「관공서의 공휴일에 관한 규정」 제2조 고정 양력 공휴일(MST 285779), 규정 개정 시 수정.
export const FIXED_SOLAR_HOLIDAYS: readonly string[] = [
  "01-01",
  "03-01",
  "05-01",
  "05-05",
  "06-06",
  "07-17",
  "08-15",
  "10-03",
  "10-09",
  "12-25",
];

export function checkHolidaySanity(year: number, entries: readonly HolidayEntry[]): { ok: boolean; missing: string[] } {
  const set = new Set(entries.map((e) => e.date));
  const missing = FIXED_SOLAR_HOLIDAYS.map((md) => `${String(year).padStart(4, "0")}-${md}`).filter((x) => !set.has(x));
  return { ok: missing.length === 0, missing };
}
