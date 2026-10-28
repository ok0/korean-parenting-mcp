import { loadData } from "../data-store/load.js";
import { DAYCARE_STAGES, type DaycareGuideFile, type DaycareLinkEntry } from "../data-store/schema.js";
import { addMonthsClamp, compare, type CivilDate } from "../date/civil-date.js";
import type { Region } from "../region/normalize.js";

export type DaycareStage = (typeof DAYCARE_STAGES)[number];
export type DaycareLink = DaycareLinkEntry;

/** 링크 목록의 단일 경계. 이후 API 기반 구현이 이 인터페이스만 대체한다. */
export interface DaycareLinkProvider {
  links(input: { stage: DaycareStage; region?: Region }): readonly DaycareLink[];
}

export const staticLinkProvider: DaycareLinkProvider = {
  links({ stage }) {
    return loadData("daycare-guide").links.filter((l) => !l.stages || l.stages.includes(stage));
  },
};

export type DaycareGuideContent = Omit<DaycareGuideFile, "links">;

export function guideContent(): DaycareGuideContent {
  const { links: _links, ...rest } = loadData("daycare-guide");
  return { ...rest };
}

export function ageInMonths(birth: CivilDate, today: CivilDate): number {
  let n = (today.y - birth.y) * 12 + (today.m - birth.m);
  while (n > 0 && compare(addMonthsClamp(birth, n), today) > 0) n--;
  while (compare(addMonthsClamp(birth, n + 1), today) <= 0) n++;
  return Math.max(0, n);
}

export type StageResult = { ok: true; stage: DaycareStage; months?: number } | { ok: false; message: string };

export function daycareStage(input: { birth?: CivilDate; due?: CivilDate }, today: CivilDate): StageResult {
  if (input.due) {
    if (compare(input.due, today) < 0) {
      return { ok: false, message: "due_date가 기준일보다 앞입니다. 출산 후라면 birth_date(생년월일)를 입력하세요." };
    }
    return { ok: true, stage: "pregnancy" };
  }
  if (input.birth) {
    if (compare(input.birth, today) > 0) {
      return { ok: false, message: "birth_date가 기준일보다 뒤입니다. 임신 중이라면 due_date(출산예정일)를 입력하세요." };
    }
    const m = ageInMonths(input.birth, today);
    if (m < 12) return { ok: true, stage: "m0_11", months: m };
    if (m < 24) return { ok: true, stage: "m12_23", months: m };
    if (m < 36) return { ok: true, stage: "m24_35", months: m };
    return { ok: true, stage: "age3plus", months: m };
  }
  return { ok: true, stage: "general" };
}
