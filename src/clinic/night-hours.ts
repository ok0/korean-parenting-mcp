import { dayOfWeek, isValidDate, makeDate, type CivilDate } from "../date/civil-date.js";

export type DaySlot = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type OpenStatus = "진료 중" | "진료 시간 아님" | "확인 불가";
export type ClinicKind = "달빛어린이병원" | "소아청소년과" | "진료과목에 소아청소년과 포함";

// 기관명 기준 소아 계열 판별(M12 L1/L5: D002 110곳 중 19곳)
export const PEDS_NAME_RE = /소아청소년과|소아과|아동|어린이|키즈/;

export const SLOT_LABEL: Record<DaySlot, string> = {
  1: "월요일",
  2: "화요일",
  3: "수요일",
  4: "목요일",
  5: "금요일",
  6: "토요일",
  7: "일요일",
  8: "공휴일",
};

const KST_OFFSET_MS = 9 * 3_600_000;
const NOW_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})?$/;

export function parseNowInput(s: string): Date | undefined {
  const m = NOW_RE.exec(s.trim());
  if (!m) return undefined;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const hh = Number(m[4]);
  const mi = Number(m[5]);
  const ss = m[6] === undefined ? 0 : Number(m[6]);
  if (!isValidDate(y, mo, d)) return undefined;
  if (hh > 23 || mi > 59 || ss > 59) return undefined;
  const zone = m[7];
  let offsetMinutes = 9 * 60;
  if (zone === "Z") {
    offsetMinutes = 0;
  } else if (zone !== undefined) {
    const sign = zone[0] === "-" ? -1 : 1;
    const digits = zone.slice(1).replace(":", "");
    const oh = Number(digits.slice(0, 2));
    const om = Number(digits.slice(2, 4));
    if (oh > 14 || om > 59) return undefined;
    offsetMinutes = sign * (oh * 60 + om);
  }
  return new Date(Date.UTC(y, mo - 1, d, hh, mi, ss) - offsetMinutes * 60_000);
}

export function kstMoment(d: Date): { date: CivilDate; minutes: number } {
  const t = new Date(d.getTime() + KST_OFFSET_MS);
  return {
    date: makeDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()),
    minutes: t.getUTCHours() * 60 + t.getUTCMinutes(),
  };
}

export function weekdaySlot(date: CivilDate): Exclude<DaySlot, 8> {
  const n = dayOfWeek(date);
  return (n === 0 ? 7 : n) as Exclude<DaySlot, 8>;
}

export function parseHhmm(v: unknown): number | undefined {
  if (typeof v !== "string" && typeof v !== "number") return undefined;
  const s = String(v).trim();
  if (!/^\d{4}$/.test(s)) return undefined;
  const hh = Number(s.slice(0, 2));
  const mm = Number(s.slice(2, 4));
  if (hh > 24 || mm > 59) return undefined;
  if (hh === 24) return mm === 0 ? 1440 : undefined;
  return hh * 60 + mm;
}

export function formatHhmm(min: number): string {
  if (min === 1440) return "24:00";
  const hh = Math.floor(min / 60);
  const mm = min % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export interface Clinic {
  key: string;
  name: string;
  kind: ClinicKind;
  addr?: string;
  tel?: string;
  item: Record<string, unknown>;
  order: number;
}

export interface Judgement {
  status: OpenStatus;
  hoursText?: string;
  carriedText?: string;
}

interface SlotRange {
  s: number;
  c: number;
  overnight: boolean;
}

function slotRange(item: Record<string, unknown>, slot: DaySlot): SlotRange | undefined {
  const s = parseHhmm(item[`dutyTime${slot}s`]);
  const c = parseHhmm(item[`dutyTime${slot}c`]);
  if (s === undefined || c === undefined || s === 1440) return undefined;
  return { s, c, overnight: c <= s };
}

export function judgeOpen(
  item: Record<string, unknown>,
  today: DaySlot,
  prev: DaySlot,
  minutes: number,
  prevLabel: string,
): Judgement {
  const t = slotRange(item, today);
  const p = slotRange(item, prev);
  const carried = p !== undefined && p.overnight && minutes < p.c;
  const carriedText = p !== undefined && carried ? `전날(${prevLabel}) 진료가 ${formatHhmm(p.c)}까지 이어짐` : undefined;
  if (t === undefined) {
    return carried ? { status: "진료 중", carriedText } : { status: "확인 불가" };
  }
  const openToday = t.overnight ? minutes >= t.s : minutes >= t.s && minutes < t.c;
  const hoursText = t.overnight
    ? `${formatHhmm(t.s)}~다음 날 ${formatHhmm(t.c)}`
    : `${formatHhmm(t.s)}~${formatHhmm(t.c)}`;
  const status: OpenStatus = openToday || carried ? "진료 중" : "진료 시간 아님";
  if (!openToday && carried) {
    return { status, hoursText, carriedText };
  }
  return { status, hoursText };
}

function str(v: unknown): string | undefined {
  if (typeof v !== "string" && typeof v !== "number") return undefined;
  const s = String(v).trim();
  return s === "" ? undefined : s;
}

export function mergeClinics(
  moon: readonly Record<string, unknown>[],
  peds: readonly Record<string, unknown>[],
): Clinic[] {
  const out: Clinic[] = [];
  const seen = new Set<string>();
  const add = (item: Record<string, unknown>, kindOf: (name: string) => ClinicKind): void => {
    const key = str(item["hpid"]) ?? `${str(item["dutyName"]) ?? ""}|${str(item["dutyAddr"]) ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    const name = str(item["dutyName"]) ?? "이름 정보 없음";
    out.push({
      key,
      name,
      kind: kindOf(name),
      addr: str(item["dutyAddr"]),
      tel: str(item["dutyTel1"]),
      item,
      order: out.length,
    });
  };
  for (const item of moon) add(item, () => "달빛어린이병원");
  for (const item of peds) {
    add(item, (name) => (PEDS_NAME_RE.test(name) ? "소아청소년과" : "진료과목에 소아청소년과 포함"));
  }
  return out;
}

const STATUS_RANK: Record<OpenStatus, number> = { "진료 중": 0, "확인 불가": 1, "진료 시간 아님": 2 };
const KIND_RANK: Record<ClinicKind, number> = {
  달빛어린이병원: 0,
  소아청소년과: 1,
  "진료과목에 소아청소년과 포함": 2,
};

export function sortJudged<T extends { clinic: Clinic; judgement: Judgement }>(rows: readonly T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      STATUS_RANK[a.judgement.status] - STATUS_RANK[b.judgement.status] ||
      KIND_RANK[a.clinic.kind] - KIND_RANK[b.clinic.kind] ||
      a.clinic.order - b.clinic.order,
  );
}
