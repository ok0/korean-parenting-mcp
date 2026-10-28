import { dayOfWeek, daysBetween, formatDate, parseDate, type CivilDate } from "./civil-date.js";
import type { HolidayEntry } from "./holiday-sanity.js";
import { loadData } from "../data-store/load.js";
import type { HolidaysFile } from "../data-store/schema.js";

export type HolidaySource = "bundled" | "live";

export interface HolidayCalendar {
  isPublicHoliday(d: CivilDate): boolean;
  isNonWorkingDay(d: CivilDate): boolean;
  coverage(year: number): HolidaySource | "none";
  notes: string[];
}

export const STALE_AFTER_DAYS = 180;

export function missingYearNote(year: number): string {
  return `${year}년 공휴일 정보 없음: 마감일이 휴일이면 연장될 수 있으나 반영하지 않았습니다. 원래 말일 기준으로 준비하세요.`;
}

export function staleBundleNote(generatedAt: CivilDate): string {
  return `번들 공휴일 표(생성일 ${formatDate(generatedAt)}) 이후 지정된 임시공휴일은 반영되지 않았을 수 있습니다.`;
}

export function createCalendar(
  years: Record<number, { source: HolidaySource; entries: readonly HolidayEntry[] }>,
  notes: string[] = [],
): HolidayCalendar {
  const sources = new Map<number, HolidaySource>();
  const dates = new Set<string>();
  for (const [key, value] of Object.entries(years)) {
    sources.set(Number(key), value.source);
    for (const entry of value.entries) {
      dates.add(entry.date);
    }
  }
  const isPublicHoliday = (d: CivilDate): boolean => sources.has(d.y) && dates.has(formatDate(d));
  return {
    isPublicHoliday,
    isNonWorkingDay: (d: CivilDate): boolean => {
      const dow = dayOfWeek(d);
      return dow === 0 || dow === 6 || isPublicHoliday(d);
    },
    coverage: (year: number): HolidaySource | "none" => sources.get(year) ?? "none",
    notes: [...notes],
  };
}

export function bundledCalendar(
  opts: { years?: readonly number[]; referenceDate?: CivilDate; data?: HolidaysFile } = {},
): HolidayCalendar {
  const data = opts.data ?? loadData("holidays");
  const years: Record<number, { source: HolidaySource; entries: readonly HolidayEntry[] }> = {};
  for (const y of data.covers_years) {
    years[y] = { source: "bundled", entries: data.years[String(y)] ?? [] };
  }
  const notes: string[] = [];
  const requested = [...new Set(opts.years ?? [])].sort((a, b) => a - b);
  for (const y of requested) {
    if (!data.covers_years.includes(y)) {
      notes.push(missingYearNote(y));
    }
  }
  if (opts.referenceDate) {
    const generated = parseDate(data.generated_at);
    if (daysBetween(generated, opts.referenceDate) >= STALE_AFTER_DAYS) {
      notes.push(staleBundleNote(generated));
    }
  }
  return createCalendar(years, notes);
}
