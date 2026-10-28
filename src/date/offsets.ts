import { addDays, addMonthsClamp, type CivilDate } from "./civil-date.js";

export interface Offset {
  months?: number;
  days?: number;
}

export function applyOffset(base: CivilDate, o: Offset): CivilDate {
  return addDays(addMonthsClamp(base, o.months ?? 0), o.days ?? 0);
}
