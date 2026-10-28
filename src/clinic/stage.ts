import { compare, daysBetween, type CivilDate } from "../date/civil-date.js";
import { loadData } from "../data-store/load.js";
import type { CheckupProgram, Provenance } from "../data-store/schema.js";
import { ageInMonths } from "../daycare/guide.js";
import { IMMINENT_DAYS } from "../timeline/engine.js";
import { checkupItems, PROGRAM_LABEL, rangeLabel } from "../timeline/rules/checkups.js";
import { pickProvenance } from "../timeline/rules/common.js";
import { doseItems, doseTitle, influenzaItems } from "../timeline/rules/vaccination.js";
import type { TimelineItem } from "../timeline/types.js";

export const WINDOW_IMMINENT_DAYS = IMMINENT_DAYS;

export type ChildStage =
  | { kind: "birth"; birth: CivilDate; months: number }
  | { kind: "due"; due: CivilDate }
  | { kind: "none" };

export type ChildStageResult = { ok: true; stage: ChildStage } | { ok: false; message: string };

export function childStage(input: { birth?: CivilDate; due?: CivilDate }, today: CivilDate): ChildStageResult {
  if (input.due) {
    if (compare(input.due, today) < 0) {
      return { ok: false, message: "due_date가 기준일보다 앞입니다. 출산 후라면 birth_date(생년월일)를 입력하세요." };
    }
    return { ok: true, stage: { kind: "due", due: input.due } };
  }
  if (input.birth) {
    if (compare(input.birth, today) > 0) {
      return { ok: false, message: "birth_date가 기준일보다 뒤입니다. 임신 중이라면 due_date(출산예정일)를 입력하세요." };
    }
    return { ok: true, stage: { kind: "birth", birth: input.birth, months: ageInMonths(input.birth, today) } };
  }
  return { ok: true, stage: { kind: "none" } };
}

export interface WindowItem {
  id: string;
  title: string;
  start: CivilDate;
  end: CivilDate;
  notes: readonly string[];
  provenance: Provenance;
}

export interface WindowPick {
  current: WindowItem[];
  recent: WindowItem[];
  next: WindowItem[];
  nextStart?: CivilDate;
  imminent: boolean;
}

function latest(dates: readonly CivilDate[]): CivilDate | undefined {
  return dates.reduce<CivilDate | undefined>((a, d) => (a === undefined || compare(d, a) > 0 ? d : a), undefined);
}

function earliest(dates: readonly CivilDate[]): CivilDate | undefined {
  return dates.reduce<CivilDate | undefined>((a, d) => (a === undefined || compare(d, a) < 0 ? d : a), undefined);
}

export function pickWindows(items: readonly WindowItem[], today: CivilDate): WindowPick {
  const current = items.filter((i) => compare(i.start, today) <= 0 && compare(today, i.end) <= 0);
  const past = items.filter((i) => compare(i.end, today) < 0);
  const future = items.filter((i) => compare(i.start, today) > 0);
  const pastEnd = latest(past.map((i) => i.end));
  const recent = past.filter((i) => pastEnd !== undefined && compare(i.end, pastEnd) === 0);
  const nextStart = earliest(future.map((i) => i.start));
  const next = future.filter((i) => nextStart !== undefined && compare(i.start, nextStart) === 0);
  const imminent = nextStart !== undefined && daysBetween(today, nextStart) <= IMMINENT_DAYS;
  return { current, recent, next, nextStart, imminent };
}

function toWindow(i: TimelineItem): WindowItem {
  return {
    id: i.id,
    title: i.title,
    start: i.start,
    end: i.end ?? i.start,
    notes: i.notes,
    provenance: i.provenance,
  };
}

export function vaccineWindows(birth: CivilDate): WindowItem[] {
  return [...doseItems(birth), ...influenzaItems(birth)].map(toWindow);
}

export function birthDoses(): { title: string; provenance: Provenance }[] {
  return loadData("vaccinations").vaccines.flatMap((e) =>
    e.doses
      .filter((d) => "days" in d.from && d.from.days === 0)
      .map((d) => ({ title: doseTitle(e, d), provenance: pickProvenance(e) })),
  );
}

export interface CheckupProgramWindows {
  program: CheckupProgram;
  label: string;
  items: WindowItem[];
}

const PROGRAMS: readonly CheckupProgram[] = ["infant", "oral"];

export function checkupWindows(birth: CivilDate): CheckupProgramWindows[] {
  const items = checkupItems(birth);
  const entries = loadData("checkups").checkups;
  return PROGRAMS.map((program) => ({
    program,
    label: PROGRAM_LABEL[program],
    items: items
      .filter((i) => entries.find((e) => e.id === i.id)?.program === program)
      .map(toWindow),
  }));
}

export function checkupRoundTable(): { label: string; rounds: string[]; provenance: Provenance[] }[] {
  const entries = loadData("checkups").checkups;
  return PROGRAMS.map((p) => {
    const es = entries.filter((e) => e.program === p);
    return {
      label: PROGRAM_LABEL[p],
      rounds: es.map((e) => `${e.round}차 ${rangeLabel(e.from, e.to)}`),
      provenance: es.map((e) => pickProvenance(e)),
    };
  });
}

export function firstInfantRound(): { label: string; provenance: Provenance } {
  const e = loadData("checkups").checkups.find((c) => c.program === "infant" && c.round === 1);
  if (e === undefined) {
    throw new Error("checkups.json에 영유아 건강검진 1차 없음");
  }
  return { label: `1차(${rangeLabel(e.from, e.to)})`, provenance: pickProvenance(e) };
}
