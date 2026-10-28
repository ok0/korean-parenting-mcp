import { compare } from "../../date/civil-date.js";
import type { TimelineNoticeRule } from "../types.js";

export const FETUS_COUNT_NOTICE =
  "태아(아이)가 둘 이상이면 fetus_count를 지정하세요(예: fetus_count: 2). 지정하지 않으면 1명 기준으로 계산합니다.";

export const OVERDUE_NOTICE = "예정일이 지났습니다. 출산하셨다면 birth_date로 다시 호출하세요(예: birth_date: \"2026-10-20\").";

export const inputNotices: TimelineNoticeRule = (input) => [
  ...(input.mode === "pregnant" && input.dueDate !== undefined && compare(input.dueDate, input.referenceDate) < 0
    ? [OVERDUE_NOTICE]
    : []),
  ...(input.fetusCount === undefined ? [FETUS_COUNT_NOTICE] : []),
];
