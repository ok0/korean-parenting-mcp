import { addDays, addMonthsClamp, compare, parseDate, type CivilDate } from "../../date/civil-date.js";
import { offsetRange } from "../../date/offsets.js";
import { loadData } from "../../data-store/load.js";
import type { InfluenzaSeason, VaccineDose, VaccineEntry, VaccineOffset } from "../../data-store/schema.js";
import { pickProvenance } from "./common.js";
import type { TimelineItem, TimelineNoticeRule, TimelineRule } from "../types.js";

export const SAME_PERIOD_NOTE = "같은 기간에 여러 차수가 있습니다. 차수 사이 간격은 국가예방접종 지침이나 의료기관에서 확인하세요.";

export const UNVERIFIED_NOTE = "미검증 항목입니다. 대상·월령 한도 등은 국가예방접종 지침 원문을 확인하세요.";

export function fluTwoDoseNote(years: number): string {
  return `만 ${years}세 미만은 처음 접종하거나 접종 이력이 불명확하면 2회 접종 대상입니다(접종 간격은 지침 확인).`;
}

export function pregnantFluNote(doses: number): string {
  return `임신부는 임신 주수 무관 ${doses}회 접종 대상입니다.`;
}

export function afterSeasonNotice(s: InfluenzaSeason): string {
  return `인플루엔자: 등록된 절기(${s.label}) 이후 정보 없음. 대상 연령 동안 매년 접종하니 다음 절기 일정은 질병관리청 공지를 확인하세요.`;
}

export function doseLabel(d: VaccineDose): string {
  if (d.label !== undefined) return d.label;
  const { from, to } = d;
  if ("days" in from && "days" in to) {
    return from.days === to.days ? `생후 ${from.days}일` : `생후 ${from.days}~${to.days}일`;
  }
  if ("months" in from && "months" in to) {
    return from.months === to.months ? `${from.months}개월` : `${from.months}~${to.months}개월`;
  }
  if ("years" in from && "years" in to) {
    return from.years === to.years ? `${from.years}세` : `${from.years}~${to.years}세`;
  }
  throw new Error(`접종 차수의 from과 to 단위가 다릅니다: ${d.dose}차`);
}

export function doseTitle(e: VaccineEntry, d: VaccineDose): string {
  return `${e.name} ${d.dose}차 (${d.alias !== undefined ? `${d.alias}, ` : ""}${doseLabel(d)})`;
}

function sameOffset(a: VaccineOffset, b: VaccineOffset): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function ageEnd(birth: CivilDate, years: number): CivilDate {
  return addDays(addMonthsClamp(birth, (years + 1) * 12), -1);
}

export function doseItems(birth: CivilDate): TimelineItem[] {
  return loadData("vaccinations").vaccines.flatMap((e) =>
    e.doses.map((d): TimelineItem => {
      const r = offsetRange(birth, d.from, d.to);
      const notes = [...e.notes];
      if (e.doses.some((o) => o.dose !== d.dose && sameOffset(o.from, d.from) && sameOffset(o.to, d.to))) {
        notes.push(SAME_PERIOD_NOTE);
      }
      if (e.verified === "false") {
        notes.push(UNVERIFIED_NOTE);
      }
      return {
        id: `vac-${e.id}-${d.dose}`,
        category: "접종",
        title: doseTitle(e, d),
        nature: "권장",
        start: r.start,
        end: r.end,
        notes,
        provenance: pickProvenance(e),
      };
    }),
  );
}

export function childFluWindow(
  birth: CivilDate,
  s: InfluenzaSeason,
): { start: CivilDate; end: CivilDate } | undefined {
  const ageStart = addMonthsClamp(birth, s.child_from_months);
  const end0 = ageEnd(birth, s.child_max_age_years);
  const seasonStart = parseDate(s.start);
  const seasonEnd = parseDate(s.end);
  const start = compare(seasonStart, ageStart) >= 0 ? seasonStart : ageStart;
  const end = compare(seasonEnd, end0) <= 0 ? seasonEnd : end0;
  return compare(start, end) <= 0 ? { start, end } : undefined;
}

export function influenzaItems(birth: CivilDate): TimelineItem[] {
  return loadData("vaccinations").influenza.seasons.flatMap((s): TimelineItem[] => {
    const w = childFluWindow(birth, s);
    if (w === undefined) return [];
    const notes = [...s.notes];
    if (compare(w.start, addMonthsClamp(birth, s.two_dose_under_years * 12)) < 0) {
      notes.push(fluTwoDoseNote(s.two_dose_under_years));
    }
    return [
      {
        id: `vac-${s.id}`,
        category: "접종",
        title: `인플루엔자 (${s.label})`,
        nature: "권장",
        start: w.start,
        end: w.end,
        notes,
        provenance: pickProvenance(s),
      },
    ];
  });
}

export const vaccinationRule: TimelineRule = (input) => [
  ...doseItems(input.birthDate),
  ...influenzaItems(input.birthDate),
];

export const influenzaNotices: TimelineNoticeRule = (input) => {
  const seasons = loadData("vaccinations").influenza.seasons;
  const last = seasons.reduce((a, b) => (compare(parseDate(b.end), parseDate(a.end)) > 0 ? b : a));
  return compare(ageEnd(input.birthDate, last.child_max_age_years), parseDate(last.end)) > 0
    ? [afterSeasonNotice(last)]
    : [];
};

export function pregnancyInfluenzaItems(dueDate: CivilDate): TimelineItem[] {
  return loadData("vaccinations").influenza.seasons.flatMap((s): TimelineItem[] => {
    const start = parseDate(s.start);
    if (compare(start, dueDate) > 0) return [];
    const seasonEnd = parseDate(s.end);
    const end = compare(seasonEnd, dueDate) <= 0 ? seasonEnd : dueDate;
    return [
      {
        id: `vac-${s.id}-pregnant`,
        category: "접종",
        title: `인플루엔자 임신부 (${s.label})`,
        nature: "권장",
        start,
        end,
        notes: [...s.notes, pregnantFluNote(s.pregnant_doses)],
        estimated: true,
        provenance: pickProvenance(s),
      },
    ];
  });
}
