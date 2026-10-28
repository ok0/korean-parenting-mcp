import { addDays, addMonthsClamp, formatDate, type CivilDate } from "../../date/civil-date.js";
import { missingYearNote } from "../../date/holiday-calendar.js";
import { computeDeadline } from "../../date/legal-period.js";
import { loadData } from "../../data-store/load.js";
import type { DeadlineEntry, Provenance } from "../../data-store/schema.js";
import type { Category, Nature, TimelineInput, TimelineItem } from "../types.js";

export function pickProvenance(p: Provenance): Provenance {
  return {
    basis_ids: [...p.basis_ids],
    as_of: p.as_of,
    verified: p.verified,
    verified_by: p.verified_by,
    verified_on: p.verified_on,
    note: p.note,
  };
}

export function findDeadline(id: string): DeadlineEntry {
  const entry = loadData("deadlines").deadlines.find((d) => d.id === id);
  if (entry === undefined) {
    throw new Error(`deadlines.json에 규칙 없음: ${id}`);
  }
  return entry;
}

export function extensionNote(original: CivilDate, extended: CivilDate): string {
  return `원래 말일 ${formatDate(original)}이 토요일·일요일·공휴일이라 ${formatDate(extended)}까지 연장된 것으로 계산했습니다. 보수적으로 원래 말일(${formatDate(original)})까지 준비하세요.`;
}

export function deadlineItem(
  input: TimelineInput,
  entry: DeadlineEntry,
  kind: { category: Category; nature: Nature },
): TimelineItem {
  const d = computeDeadline(input.birthDate, entry.rule, input.holidays);
  const notes = [...entry.notes];
  if (d.extendedFrom !== undefined) {
    notes.push(extensionNote(d.extendedFrom, d.end));
  }
  if (d.holidayDataMissing) {
    const years = [...new Set([(d.extendedFrom ?? d.end).y, d.end.y])].sort((a, b) => a - b);
    for (const y of years) {
      if (input.holidays.coverage(y) === "none") {
        notes.push(missingYearNote(y));
      }
    }
  }
  return {
    id: entry.id,
    category: kind.category,
    title: entry.title,
    nature: kind.nature,
    start: input.birthDate,
    end: d.end,
    notes,
    provenance: pickProvenance(entry),
  };
}

export interface VersionRange {
  effective_from: string;
  effective_to?: string;
}

export function selectVersion<T extends VersionRange>(
  versions: readonly T[],
  date: CivilDate,
): { version: T; fallback: boolean } | undefined {
  const d = formatDate(date);
  let prior: T | undefined;
  for (const v of versions) {
    if (v.effective_from > d) break;
    if (v.effective_to === undefined || d <= v.effective_to) {
      return { version: v, fallback: false };
    }
    prior = v;
  }
  return prior ? { version: prior, fallback: true } : undefined;
}

export function fallbackNote(v: VersionRange): string {
  return `해당 시점 표 미등록, 직전 버전 기준(${v.effective_from} 시행 버전). 최신 내용은 복지로·정부24에서 확인하세요.`;
}

export function earliestVersionNote(v: VersionRange): string {
  return `해당 시점 표 미등록, 가장 이른 등록 버전 기준(${v.effective_from} 시행 버전). 복지로·정부24에서 확인하세요.`;
}

export function beforeBirthday(birth: CivilDate, years: number): CivilDate {
  return addDays(addMonthsClamp(birth, 12 * years), -1);
}

export function formatWon(won: number): string {
  return `${won / 10000}만원`;
}
