import { addDays, compare, lastDayOfMonth, type CivilDate } from "./civil-date.js";
import type { HolidayCalendar } from "./holiday-calendar.js";

export interface PeriodRule {
  unit: "day" | "month";
  amount: number;
  countFirstDay: boolean;
  extendIfNonWorking: boolean;
}

export interface Deadline {
  end: CivilDate;
  extendedFrom?: CivilDate;
  holidayDataMissing: boolean;
}

export function computeDeadline(event: CivilDate, rule: PeriodRule, cal: HolidayCalendar): Deadline {
  if (!Number.isInteger(rule.amount) || rule.amount < 1) {
    throw new RangeError(`기간 수량은 1 이상의 정수여야 합니다: ${rule.amount}`);
  }
  const s = rule.countFirstDay ? event : addDays(event, 1);
  let base: CivilDate;
  if (rule.unit === "day") {
    base = addDays(s, rule.amount - 1);
  } else {
    const idx = s.y * 12 + (s.m - 1) + rule.amount;
    const ty = Math.floor(idx / 12);
    const tm = idx - ty * 12 + 1;
    base =
      s.d <= lastDayOfMonth(ty, tm)
        ? addDays({ y: ty, m: tm, d: s.d }, -1)
        : { y: ty, m: tm, d: lastDayOfMonth(ty, tm) };
  }
  if (!rule.extendIfNonWorking) {
    return { end: base, holidayDataMissing: false };
  }
  let cur = base;
  let guard = 0;
  while (cal.isNonWorkingDay(cur)) {
    cur = addDays(cur, 1);
    if (++guard > 366) throw new Error("비근무일 연장이 366일을 넘었습니다");
  }
  const missing = cal.coverage(base.y) === "none" || cal.coverage(cur.y) === "none";
  if (compare(cur, base) !== 0) {
    return { end: cur, extendedFrom: base, holidayDataMissing: missing };
  }
  return { end: base, holidayDataMissing: missing };
}
