import type { Clock } from "../core/context.js";

export interface CivilDate {
  y: number;
  m: number;
  d: number;
}

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

const KST_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function isLeapYear(y: number): boolean {
  return y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
}

export function lastDayOfMonth(y: number, m: number): number {
  const days = MONTH_DAYS[m - 1] ?? 31;
  return m === 2 && isLeapYear(y) ? 29 : days;
}

export function isValidDate(y: number, m: number, d: number): boolean {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (y < 1 || y > 9999) return false;
  if (m < 1 || m > 12) return false;
  return d >= 1 && d <= lastDayOfMonth(y, m);
}

export function makeDate(y: number, m: number, d: number): CivilDate {
  if (!isValidDate(y, m, d)) {
    throw new RangeError(`존재하지 않는 날짜: ${y}-${m}-${d}`);
  }
  return { y, m, d };
}

const DATE_PATTERNS = [/^(\d{4})-(\d{2})-(\d{2})$/, /^(\d{4})\.(\d{2})\.(\d{2})$/, /^(\d{4})(\d{2})(\d{2})$/];

export function tryParseDate(s: string): CivilDate | undefined {
  const trimmed = s.trim();
  for (const pattern of DATE_PATTERNS) {
    const match = pattern.exec(trimmed);
    if (match) {
      const y = Number(match[1]);
      const m = Number(match[2]);
      const d = Number(match[3]);
      return isValidDate(y, m, d) ? { y, m, d } : undefined;
    }
  }
  return undefined;
}

export function parseDate(s: string): CivilDate {
  const parsed = tryParseDate(s);
  if (parsed === undefined) {
    throw new RangeError(`존재하지 않거나 형식이 잘못된 날짜: "${s}" (YYYY-MM-DD, YYYY.MM.DD, YYYYMMDD)`);
  }
  return parsed;
}

export function formatDate(d: CivilDate): string {
  return `${String(d.y).padStart(4, "0")}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
}

export function toEpochDay(d: CivilDate): number {
  const y = d.y - (d.m <= 2 ? 1 : 0);
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = (d.m + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + d.d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

export function fromEpochDay(n: number): CivilDate {
  const z = n + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  return { y, m, d };
}

export function addDays(d: CivilDate, n: number): CivilDate {
  return fromEpochDay(toEpochDay(d) + n);
}

export function addMonthsClamp(d: CivilDate, n: number): CivilDate {
  const idx = d.y * 12 + (d.m - 1) + n;
  const y = Math.floor(idx / 12);
  const m = idx - y * 12 + 1;
  return { y, m, d: Math.min(d.d, lastDayOfMonth(y, m)) };
}

export function daysBetween(a: CivilDate, b: CivilDate): number {
  return toEpochDay(b) - toEpochDay(a);
}

export function compare(a: CivilDate, b: CivilDate): -1 | 0 | 1 {
  return Math.sign(daysBetween(b, a)) as -1 | 0 | 1;
}

export function dayOfWeek(d: CivilDate): number {
  return ((((toEpochDay(d) % 7) + 7) % 7) + 4) % 7;
}

export function todayKst(clock: Clock): CivilDate {
  const parts = KST_PARTS.formatToParts(clock.now());
  const read = (type: "year" | "month" | "day"): number => {
    const value = parts.find((p) => p.type === type)?.value;
    return Number(value);
  };
  return makeDate(read("year"), read("month"), read("day"));
}
