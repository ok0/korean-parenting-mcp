import { addMonthsClamp, formatDate, type CivilDate } from "../../date/civil-date.js";
import { loadData } from "../../data-store/load.js";
import type { BenefitTable } from "../../data-store/schema.js";
import {
  beforeBirthday,
  deadlineItem,
  earliestVersionNote,
  fallbackNote,
  formatWon,
  pickProvenance,
  selectVersion,
  type VersionRange,
} from "./common.js";
import { lmpFromDue } from "./prenatal.js";
import type { TimelineInput, TimelineItem, TimelineRule } from "../types.js";

function baseDate<T extends VersionRange>(table: BenefitTable<T>, input: TimelineInput): CivilDate {
  return table.select_by === "reference_date" ? input.referenceDate : input.birthDate;
}

function pickOrEarliest<T extends VersionRange>(
  table: BenefitTable<T>,
  input: TimelineInput,
): { version: T; notes: string[] } {
  const found = selectVersion(table.versions, baseDate(table, input));
  if (found !== undefined) {
    return { version: found.version, notes: found.fallback ? [fallbackNote(found.version)] : [] };
  }
  const earliest = table.versions[0]!;
  return { version: earliest, notes: [earliestVersionNote(earliest)] };
}

export function parentAllowanceItems(
  input: TimelineInput,
  table = loadData("benefits").parent_allowance,
): TimelineItem[] {
  const { version: v, notes: vNotes } = pickOrEarliest(table, input);
  const b = input.birthDate;
  return [
    {
      id: "parent-allowance-age0",
      category: "지원",
      nature: "지원 신청",
      title: `부모급여 0세 구간 (월 ${formatWon(v.monthly_won.age0)})`,
      start: b,
      end: beforeBirthday(b, 1),
      notes: [...vNotes, ...v.notes],
      provenance: pickProvenance(v),
    },
    {
      id: "parent-allowance-age1",
      category: "지원",
      nature: "지원 신청",
      title: `부모급여 1세 구간 (월 ${formatWon(v.monthly_won.age1)})`,
      start: addMonthsClamp(b, 12),
      end: beforeBirthday(b, 2),
      notes: [...vNotes, ...v.notes],
      provenance: pickProvenance(v),
    },
  ];
}

export function childAllowanceItems(
  input: TimelineInput,
  table = loadData("benefits").child_allowance,
): TimelineItem[] {
  const { version: v, notes: vNotes } = pickOrEarliest(table, input);
  const b = input.birthDate;
  const later = table.versions.filter((x) => x.effective_from > v.effective_from);
  const expansion =
    later.length > 0
      ? `확대 예정: ${later.map((x) => `${x.effective_from.slice(0, 4)}년부터 만 ${x.age_under_years}세 미만`).join(", ")}. 연령은 매년 변경되며 실제로 몇 세까지 받는지는 단정하지 않습니다.`
      : "연령은 매년 변경될 수 있습니다.";
  return [
    {
      id: "child-allowance-period",
      category: "지원",
      nature: "지원 신청",
      title: `아동수당 지급 구간 (월 ${formatWon(v.monthly_won)}, 만 ${v.age_under_years}세 미만, ${v.effective_from.slice(0, 4)}년 기준)`,
      start: b,
      end: beforeBirthday(b, v.age_under_years),
      notes: [
        ...vNotes,
        `지역 가산: ${v.regional_rates.map((r) => `${r.label} 월 ${formatWon(r.monthly_won)}`).join(", ")}, 지역사랑상품권 지급 시 월 ${formatWon(v.voucher_bonus_won)} 추가. 지역에 따라 가산되며 이 도구는 지역별 금액을 계산하지 않습니다(지자체 확인).`,
        expansion,
        ...v.notes,
      ],
      provenance: pickProvenance(v),
    },
  ];
}

export function firstMeetingItems(
  input: TimelineInput,
  table = loadData("benefits").first_meeting,
): TimelineItem[] {
  const b = input.birthDate;
  const p = selectVersion(table.versions, baseDate(table, input));
  if (p === undefined) {
    return [
      {
        id: "first-meeting",
        category: "신청",
        nature: "지원 신청",
        title: "첫만남이용권 (표 미등록 출생일)",
        start: b,
        notes: [
          `${formatDate(b)} 출생은 표 미등록: 금액과 신청 기한을 단정하지 않습니다. 복지로·정부24에서 확인하세요.`,
        ],
        provenance: pickProvenance(table.versions[0]!),
      },
    ];
  }
  const v = p.version;
  const first = formatWon(v.amount_won.first);
  const second = formatWon(v.amount_won.second_plus);
  const amount =
    input.birthOrder === undefined
      ? `첫째 ${first} / 둘째 이상 ${second}`
      : input.birthOrder === 1
        ? `첫째 ${first}`
        : `둘째 이상 ${second}`;
  return [
    deadlineItem(
      input,
      {
        id: "first-meeting",
        title: `첫만남이용권 신청 기한 (${amount})`,
        rule: v.application_period,
        notes: [...(p.fallback ? [fallbackNote(v)] : []), v.usage_period_note, ...v.notes],
        basis_ids: v.basis_ids,
        as_of: v.as_of,
        verified: v.verified,
        verified_by: v.verified_by,
        verified_on: v.verified_on,
        note: v.note,
      },
      { category: "신청", nature: "지원 신청" },
    ),
  ];
}

export function medicalCostItems(
  input: TimelineInput,
  table = loadData("benefits").pregnancy_medical,
): TimelineItem[] {
  if (input.mode !== "pregnant") return [];
  const { version: v, notes: vNotes } = pickOrEarliest(table, input);
  const due = input.dueDate ?? input.birthDate;
  const n = input.fetusCount ?? 1;
  const amount =
    n === 1
      ? formatWon(v.per_fetus_won)
      : `태아당 ${formatWon(v.per_fetus_won)} × ${n} = 합계 ${formatWon(v.per_fetus_won * n)}`;
  return [
    {
      id: "pregnancy-medical-cost",
      category: "지원",
      nature: "지원 신청",
      title: `임신·출산 진료비 지원 (${amount}, 임신 확인 후~출산예정일)`,
      start: lmpFromDue(due),
      end: due,
      notes: [
        ...vNotes,
        "시작일은 임신 0주(출산예정일 280일 전) 기준 표시이며 실제로는 임신 확인 후 신청해 사용합니다.",
        v.usage_period_note,
        v.conflict_note,
        ...v.notes,
      ],
      provenance: pickProvenance(v),
    },
  ];
}

export function parentAllowanceMemo(input: TimelineInput): string {
  const { version: v } = pickOrEarliest(loadData("benefits").parent_allowance, input);
  return `금액(${v.effective_from} 시행 표): 0세 월 ${formatWon(v.monthly_won.age0)}, 1세 월 ${formatWon(v.monthly_won.age1)}. 구간별 항목을 참고하세요.`;
}

export function childAllowanceMemo(input: TimelineInput): string {
  const { version: v } = pickOrEarliest(loadData("benefits").child_allowance, input);
  return `금액(${v.effective_from} 시행 표): 월 ${formatWon(v.monthly_won)}(지역에 따라 가산), 지급 연령 만 ${v.age_under_years}세 미만.`;
}

export const benefitAmountRule: TimelineRule = (input) => [
  ...parentAllowanceItems(input),
  ...childAllowanceItems(input),
  ...firstMeetingItems(input),
  ...medicalCostItems(input),
];
