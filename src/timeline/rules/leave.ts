import { addDays, compare, parseDate, type CivilDate } from "../../date/civil-date.js";
import { loadData } from "../../data-store/load.js";
import { beforeBirthday, pickProvenance } from "./common.js";
import type { TimelineInput, TimelineItem, TimelineRule } from "../types.js";

export function spouseLeaveItems(
  input: TimelineInput,
  data = loadData("leave").spouse_leave,
): TimelineItem[] {
  const [oldV, neu] = data.versions;
  const T: CivilDate = parseDate(neu!.effective_from!);
  const b = input.birthDate;
  const pregnant = input.mode === "pregnant";
  if (compare(addDays(b, oldV!.after_birth_days), T) < 0) {
    return [
      {
        id: "spouse-leave",
        category: "휴가",
        nature: "안내",
        title: `배우자 출산휴가 (${oldV!.label})`,
        start: b,
        end: addDays(b, oldV!.after_birth_days),
        notes: [...oldV!.notes],
        provenance: pickProvenance(oldV!),
      },
    ];
  }
  const raw = pregnant ? addDays(b, -neu!.before_due_days!) : b;
  const shifted = compare(raw, T) < 0;
  return [
    {
      id: "spouse-leave",
      category: "휴가",
      nature: "안내",
      title: `배우자 출산휴가 (유급 ${neu!.paid_days}일, 최대 ${neu!.split_max}회 분할)`,
      start: shifted ? T : raw,
      end: addDays(b, neu!.after_birth_days),
      notes: [
        ...neu!.notes,
        ...(shifted ? [data.transition_note] : []),
        ...(pregnant ? [] : [data.born_mode_note]),
      ],
      provenance: pickProvenance(neu!),
    },
  ];
}

export function maternityLeaveItems(
  input: TimelineInput,
  data = loadData("leave").maternity_leave,
): TimelineItem[] {
  const multi = (input.fetusCount ?? 1) >= 2;
  const s = data.single;
  const m = data.multiple;
  return [
    {
      id: "maternity-leave",
      category: "휴가",
      nature: "안내",
      title: multi
        ? `출산전후휴가 개요 (다태아 ${m.total_days}일)`
        : `출산전후휴가 개요 (${s.total_days}일)`,
      start: input.birthDate,
      notes: [
        multi
          ? `다태아 기준: 출산 전후 통틀어 ${m.total_days}일, 출산 후 ${m.after_birth_min_days}일 이상, 최초 ${m.paid_days}일 유급.`
          : `출산 전후 통틀어 ${s.total_days}일(미숙아 ${s.premature_days}일), 출산 후 ${s.after_birth_min_days}일 이상, 최초 ${s.paid_days}일 유급.`,
        `근거: ${data.article_label}(조문시행일 ${data.article_effective}).`,
        ...data.notes,
      ],
      provenance: pickProvenance(data),
    },
  ];
}

export function parentalLeaveItems(
  input: TimelineInput,
  data = loadData("leave").parental_leave,
): TimelineItem[] {
  const b = input.birthDate;
  return [
    {
      id: "parental-leave",
      category: "휴가",
      nature: "안내",
      title: `육아휴직 개요 (${data.age_label})`,
      start: b,
      end: beforeBirthday(b, data.age_under_years),
      notes: [`근거: ${data.article_label}(조문시행일 ${data.article_effective}).`, ...data.notes],
      provenance: pickProvenance(data),
    },
  ];
}

export const leaveRule: TimelineRule = (input) => [
  ...spouseLeaveItems(input),
  ...maternityLeaveItems(input),
  ...parentalLeaveItems(input),
];
