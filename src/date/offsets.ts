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
  const end =
    "days" in to
      ? addDays(base, to.days)
      : "months" in to
        ? addDays(addMonthsClamp(base, to.months + 1), -1)
        : addDays(addMonthsClamp(base, (to.years + 1) * 12), -1);
  return { start, end };
}
