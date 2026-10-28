import { addDays, type CivilDate } from "../../date/civil-date.js";
import { loadData } from "../../data-store/load.js";
import type { PrenatalInterval } from "../../data-store/schema.js";
import { pickProvenance } from "./common.js";
import type { TimelineItem } from "../types.js";

export const PREGNANCY_DAYS = 280;

export function lmpFromDue(due: CivilDate): CivilDate {
  return addDays(due, -PREGNANCY_DAYS);
}

export function weekStart(lmp: CivilDate, week: number): CivilDate {
  return addDays(lmp, 7 * week);
}

export function cycleText(every: number): string {
  return every === 1 ? "매주 1회" : `${every}주마다 1회`;
}

export function intervalLabel(iv: PrenatalInterval): string {
  if (iv.to_week === null) return `임신 ${iv.from_week}주~출산예정일`;
  if (iv.from_week === 0) return `임신 ${iv.to_week}주 6일까지`;
  return `임신 ${iv.from_week}주~${iv.to_week}주 6일`;
}

export function prenatalItems(dueDate: CivilDate): TimelineItem[] {
  const data = loadData("prenatal");
  const lmp = lmpFromDue(dueDate);
  return data.intervals.map((iv, i) => ({
    id: `prenatal-checkup-${i + 1}`,
    category: "검진",
    title: `산전 정기 건강진단 (${intervalLabel(iv)}, ${cycleText(iv.every_weeks)})`,
    nature: "권장",
    start: weekStart(lmp, iv.from_week),
    end: iv.to_week === null ? dueDate : addDays(weekStart(lmp, iv.to_week), 6),
    notes: [
      `권장 주기: ${cycleText(iv.every_weeks)}. 구간 경계에서의 정확한 검진일은 단정하지 않습니다.`,
      ...data.notes,
      data.high_risk_note,
    ],
    estimated: true,
    provenance: pickProvenance(data),
  }));
}
