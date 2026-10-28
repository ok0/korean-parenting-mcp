import { addMonthsClamp, compare, daysBetween, type CivilDate } from "../date/civil-date.js";
import { checkupRule } from "./rules/checkups.js";
import { benefitDeadlineRule } from "./rules/benefit-deadlines.js";
import { registrationRule } from "./rules/registration.js";
import { influenzaNotices, vaccinationRule } from "./rules/vaccination.js";
import type {
  Status,
  TimelineInput,
  TimelineItem,
  TimelineNoticeRule,
  TimelineResult,
  TimelineRule,
} from "./types.js";

export const IMMINENT_DAYS = 14;

export const RULES: readonly TimelineRule[] = [registrationRule, benefitDeadlineRule, checkupRule, vaccinationRule];

export const NOTICE_RULES: readonly TimelineNoticeRule[] = [influenzaNotices];

export function statusOf(start: CivilDate, end: CivilDate | undefined, ref: CivilDate): Status {
  const e = end ?? start;
  if (compare(e, ref) < 0) return "지난";
  if (compare(start, ref) <= 0) return "진행 중";
  if (daysBetween(ref, start) <= IMMINENT_DAYS) return "임박";
  return "예정";
}

export function compareItems(a: TimelineItem, b: TimelineItem): number {
  return (
    compare(a.start, b.start) ||
    compare(a.end ?? a.start, b.end ?? b.start) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

export function buildTimeline(
  input: TimelineInput,
  rules: readonly TimelineRule[] = RULES,
  noticeRules: readonly TimelineNoticeRule[] = NOTICE_RULES,
): TimelineResult {
  const all = rules
    .flatMap((r) => r(input))
    .map((it) => ({ ...it, status: statusOf(it.start, it.end, input.referenceDate) }))
    .sort(compareItems);
  const horizon = addMonthsClamp(input.referenceDate, input.monthsAhead);
  const items: TimelineItem[] = [];
  let hiddenPast = 0;
  let hiddenFuture = 0;
  for (const it of all) {
    if (!input.includePast && it.status === "지난") {
      hiddenPast++;
    } else if (compare(it.start, horizon) > 0) {
      hiddenFuture++;
    } else {
      items.push(it);
    }
  }
  const basisIds = [...new Set(all.flatMap((it) => it.provenance.basis_ids))];
  const warnings = [...new Set(input.holidays.notes)];
  const notices = [...new Set(noticeRules.flatMap((r) => r(input)))];
  return { items, hiddenPast, hiddenFuture, warnings, basisIds, notices };
}
