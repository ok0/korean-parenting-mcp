export type KgAge = 3 | 4 | 5;
export const KG_AGES: readonly KgAge[] = [3, 4, 5];
export type Count = number | undefined;

export interface Seats {
  capacity: Count;
  enrolled: Count;
  classes: Count;
}

export interface KgRow {
  code?: string;
  name: string;
  establish?: string;
  addr?: string;
  tel?: string;
  homepage?: string;
  round?: string;
  rpst?: string;
  ages: Record<KgAge, Seats>;
  mixed: Seats;
  special: Seats;
  totalCapacity: Count;
  totalEnrolled: Count;
}

export type Vacancy =
  | { kind: "open"; seats: number }
  | { kind: "full" }
  | { kind: "noClass" }
  | { kind: "unknown" };

export interface Estimate {
  vacancy: Vacancy;
  basis: "age" | "ageSum" | "total";
}

function str(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t !== "" ? t : undefined;
}

export function toCount(v: unknown): Count {
  if (typeof v === "number") {
    return Number.isInteger(v) && v >= 0 ? v : undefined;
  }
  if (typeof v === "string") {
    const t = v.trim().replace(/,/g, "");
    return /^\d+$/.test(t) ? Number(t) : undefined;
  }
  return undefined;
}

export function toKgRow(item: Record<string, unknown>): KgRow | undefined {
  const name = str(item.kindername);
  if (name === undefined) return undefined;

  const seats = (cap: string, enr: string, cls: string): Seats => ({
    capacity: toCount(item[cap]),
    enrolled: toCount(item[enr]),
    classes: toCount(item[cls]),
  });
  const ageSeats = (a: KgAge): Seats => seats(`ag${a}fpcnt`, `ppcnt${a}`, `clcnt${a}`);

  const homepageRaw = str(item.hpaddr);
  const homepage = homepageRaw !== undefined && /^https?:\/\/\S+$/i.test(homepageRaw) ? homepageRaw : undefined;

  const enrolledParts = [item.ppcnt3, item.ppcnt4, item.ppcnt5, item.mixppcnt, item.shppcnt].map(toCount);
  const totalEnrolled = enrolledParts.every((n): n is number => n !== undefined)
    ? enrolledParts.reduce<number>((sum, n) => sum + (n ?? 0), 0)
    : undefined;

  return {
    code: str(item.kindercode) ?? str(item.kinderCode),
    name,
    establish: str(item.establish),
    addr: str(item.addr),
    tel: str(item.telno),
    homepage,
    round: str(item.pbnttmng),
    rpst: str(item.rpst_yn) ?? str(item.rpstYn),
    ages: { 3: ageSeats(3), 4: ageSeats(4), 5: ageSeats(5) },
    mixed: seats("mixfpcnt", "mixppcnt", "mixclcnt"),
    special: seats("spcnfpcnt", "shppcnt", "shclcnt"),
    totalCapacity: toCount(item.prmstfcnt),
    totalEnrolled,
  };
}

export function roundNumber(round: string | undefined): number {
  return round !== undefined && /^\d{5}$/.test(round) ? Number(round) : -1;
}

export function latestByKinder(rows: readonly KgRow[]): { rows: KgRow[]; superseded: number } {
  const groups = new Map<string, KgRow>();
  for (const row of rows) {
    const key = row.code ?? `${row.name}\u0000${row.addr ?? ""}`;
    const current = groups.get(key);
    if (current === undefined || roundNumber(row.round) > roundNumber(current.round)) {
      groups.set(key, row);
    }
  }
  const result = [...groups.values()];
  return { rows: result, superseded: rows.length - result.length };
}

export function roundsOf(rows: readonly KgRow[]): string[] {
  const unique = [...new Set(rows.map((r) => r.round).filter((r): r is string => r !== undefined))];
  return unique.sort((a, b) => {
    const diff = roundNumber(b) - roundNumber(a);
    if (diff !== 0) return diff;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

export function roundLabel(round: string | undefined): string {
  if (round === undefined) return "공시 차수 정보 없음";
  const m = /^(\d{4})([1-9])$/.exec(round);
  if (m) return `${m[1]}년 ${m[2]}차(공시차수 ${round})`;
  return `공시 차수 ${round}`;
}

export function vacancy(capacity: Count, enrolled: Count): Vacancy {
  if (capacity === undefined || enrolled === undefined) return { kind: "unknown" };
  if (capacity === 0 && enrolled === 0) return { kind: "noClass" };
  const d = capacity - enrolled;
  return d > 0 ? { kind: "open", seats: d } : { kind: "full" };
}

export function estimate(row: KgRow, age?: KgAge): Estimate {
  if (age !== undefined) {
    return { vacancy: vacancy(row.ages[age].capacity, row.ages[age].enrolled), basis: "age" };
  }
  const vs = KG_AGES.map((a) => vacancy(row.ages[a].capacity, row.ages[a].enrolled));
  if (vs.every((v) => v.kind === "unknown")) {
    return { vacancy: vacancy(row.totalCapacity, row.totalEnrolled), basis: "total" };
  }
  if (vs.some((v) => v.kind === "unknown")) {
    return { vacancy: { kind: "unknown" }, basis: "ageSum" };
  }
  let s = 0;
  for (const v of vs) {
    if (v.kind === "open") s += v.seats;
  }
  if (s > 0) return { vacancy: { kind: "open", seats: s }, basis: "ageSum" };
  if (vs.every((v) => v.kind === "noClass")) return { vacancy: { kind: "noClass" }, basis: "ageSum" };
  return { vacancy: { kind: "full" }, basis: "ageSum" };
}

export function sortSeats(e: Estimate): number {
  const v = e.vacancy;
  if (v.kind === "open") return v.seats;
  if (v.kind === "unknown") return -1;
  return 0;
}

export function compareKg(age?: KgAge): (a: KgRow, b: KgRow) => number {
  return (a, b) => {
    const score = sortSeats(estimate(b, age)) - sortSeats(estimate(a, age));
    if (score !== 0) return score;
    if (a.name !== b.name) return a.name < b.name ? -1 : 1;
    const ca = a.code ?? "";
    const cb = b.code ?? "";
    return ca < cb ? -1 : ca > cb ? 1 : 0;
  };
}

export function vacancyText(v: Vacancy): string {
  switch (v.kind) {
    case "open":
      return `여석 추정 ${v.seats}명`;
    case "full":
      return "정원 충족(여석 없음 추정)";
    case "noClass":
      return "해당 연령반 없음(공시 정원 0)";
    case "unknown":
      return "산출 불가(정보 없음)";
  }
}

export function estimateText(e: Estimate): string {
  if (e.basis === "total") {
    if (e.vacancy.kind === "unknown") return "산출 불가(연령별·총정원 정보 없음)";
    return `총정원 기준 ${vacancyText(e.vacancy)}(연령별 정원 정보 없음)`;
  }
  return `연령반 합계 ${vacancyText(e.vacancy)}`;
}
