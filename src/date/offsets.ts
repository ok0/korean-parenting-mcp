import { addDays, addMonthsClamp, type CivilDate } from "./civil-date.js";

export interface Offset {
  years?: number;
  months?: number;
  days?: number;
}

export function applyOffset(base: CivilDate, o: Offset): CivilDate {
  return addDays(addMonthsClamp(base, (o.years ?? 0) * 12 + (o.months ?? 0)), o.days ?? 0);
}

export type RangeOffset = { days: number } | { months: number } | { years: number };

export function offsetRange(
  base: CivilDate,
  from: RangeOffset,
  to: RangeOffset,
): { start: CivilDate; end: CivilDate } {
  const start = applyOffset(base, from);
  // 세 범위(예: 4~6세)는 상한 나이 생일 전날까지(2026 국가예방접종 지침 p.110 예시). 단일 세 값은 그 나이 1년.
  const end =
    "days" in to
      ? addDays(base, to.days)
      : "months" in to
        ? addDays(addMonthsClamp(base, to.months + 1), -1)
        : addDays(addMonthsClamp(base, ("years" in from && from.years < to.years ? to.years : to.years + 1) * 12), -1);
  return { start, end };
}
