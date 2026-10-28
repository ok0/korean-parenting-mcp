import { loadData } from "../data-store/load.js";
import type { SigunguEntry } from "../data-store/schema.js";
import type { Region } from "../region/normalize.js";

export type Stage = "pregnancy" | "birth" | "infant" | "all";
export const STAGES = ["pregnancy", "birth", "infant", "all"] as const;
export const STAGE_LABEL: Record<Stage, string> = {
  pregnancy: "임신",
  birth: "출산",
  infant: "영유아",
  all: "전체(임신·출산·영유아)",
};
export const STAGE_KEYWORDS: Readonly<Record<Exclude<Stage, "all">, readonly string[]>> = {
  pregnancy: ["임신", "임산부", "임부", "난임", "태아", "산전"],
  birth: ["출산", "출생", "산모", "신생아", "산후", "분만", "첫만남"],
  infant: ["영유아", "영아", "유아", "아동", "보육", "양육", "어린이집", "육아"],
};

export interface BenefitRow {
  id: string;
  name: string;
  field?: string;
  userType?: string;
  criteria?: string;
  summary?: string;
  dept?: string;
  agency?: string;
  registeredAt?: string;
  url?: string;
}

export type RegionClass = "local" | "national" | "other";

export interface Scored {
  row: BenefitRow;
  score: number;
  regionClass?: RegionClass;
}

function str(v: unknown): string | undefined {
  if (typeof v !== "string" && typeof v !== "number") return undefined;
  const t = String(v).trim();
  return t === "" ? undefined : t;
}

export function toBenefitRow(item: Record<string, unknown>): BenefitRow | undefined {
  const id = str(item["서비스ID"]);
  const name = str(item["서비스명"]);
  if (id === undefined || name === undefined) return undefined;
  const row: BenefitRow = { id, name };
  const optional: [keyof Omit<BenefitRow, "id" | "name">, string][] = [
    ["field", "서비스분야"],
    ["userType", "사용자구분"],
    ["criteria", "선정기준"],
    ["summary", "서비스목적요약"],
    ["dept", "부서명"],
    ["agency", "소관기관명"],
    ["registeredAt", "등록일시"],
    ["url", "상세조회URL"],
  ];
  for (const [key, source] of optional) {
    const value = str(item[source]);
    if (value !== undefined) row[key] = value;
  }
  return row;
}

function haystack(row: BenefitRow): string {
  return [row.name, row.summary, row.criteria, row.field]
    .filter((v): v is string => v !== undefined)
    .join("\n")
    .normalize("NFKC");
}

export function stageTerms(stage: Stage): readonly string[] {
  if (stage !== "all") return STAGE_KEYWORDS[stage];
  return [...new Set([...STAGE_KEYWORDS.pregnancy, ...STAGE_KEYWORDS.birth, ...STAGE_KEYWORDS.infant])];
}

export function keywordTerms(keyword: string | undefined): string[] {
  if (keyword === undefined) return [];
  const parts = keyword.normalize("NFKC").trim().split(/\s+/).filter((p) => p !== "");
  return [...new Set(parts)];
}

export function matchesFilter(row: BenefitRow, stage: Stage, keyword: readonly string[]): boolean {
  const text = haystack(row);
  const stageHit = stageTerms(stage).some((t) => text.includes(t));
  return stageHit && keyword.every((k) => text.includes(k));
}

export function matchScore(row: BenefitRow, terms: readonly string[]): number {
  const name = row.name.normalize("NFKC");
  const text = haystack(row);
  let score = 0;
  for (const t of terms) {
    if (name.includes(t)) score += 2;
    else if (text.includes(t)) score += 1;
  }
  return score;
}

interface SigunguLite {
  code: string;
  sido_code: string;
  parent_code?: string;
}

interface RegionIndex {
  sidoByToken: Map<string, string>;
  sggByToken: Map<string, SigunguLite[]>;
  sggByCode: Map<string, SigunguLite>;
}

function compact(s: string): string {
  return s.normalize("NFKC").replace(/\s+/g, "");
}

let regionMemo: RegionIndex | undefined;

function regionIndex(): RegionIndex {
  if (regionMemo) return regionMemo;
  const data = loadData("regions");
  const sidoByToken = new Map<string, string>();
  for (const s of data.sido) {
    for (const alias of [s.name, ...s.aliases]) {
      sidoByToken.set(compact(alias), s.code);
    }
  }
  const sggByToken = new Map<string, SigunguLite[]>();
  const sggByCode = new Map<string, SigunguLite>();
  for (const g of data.sigungu) {
    const lite = toLite(g);
    sggByCode.set(g.code, lite);
    for (const raw of [g.name, ...g.aliases]) {
      const key = raw.normalize("NFKC");
      const parts = key.split(/\s+/).filter((p) => p !== "");
      const token = parts.length > 1 ? (parts.at(-1) ?? key) : key;
      const list = sggByToken.get(token) ?? [];
      if (!list.some((e) => e.code === lite.code)) list.push(lite);
      sggByToken.set(token, list);
    }
  }
  regionMemo = { sidoByToken, sggByToken, sggByCode };
  return regionMemo;
}

function toLite(g: SigunguEntry): SigunguLite {
  return g.parent_code === undefined
    ? { code: g.code, sido_code: g.sido_code }
    : { code: g.code, sido_code: g.sido_code, parent_code: g.parent_code };
}

function tokens(text: string): string[] {
  return text
    .normalize("NFKC")
    .split(/[^0-9A-Za-z가-힣]+/)
    .filter((t) => t !== "");
}

function lookup<T>(map: Map<string, T>, token: string): T | undefined {
  const direct = map.get(token);
  if (direct !== undefined) return direct;
  if (token.endsWith("청") && token.length > 2) return map.get(token.slice(0, -1));
  return undefined;
}

export function classifyRegion(row: BenefitRow, region: Region): RegionClass {
  const idx = regionIndex();
  const targetText = [row.agency, row.dept, row.name].filter((v): v is string => v !== undefined);
  const targetTokens = targetText.flatMap(tokens);

  const targetSido = region.code !== undefined ? region.code.slice(0, 2) : idx.sidoByToken.get(compact(region.sido));
  const targetSgg = region.code;
  const targetParent = targetSgg !== undefined ? idx.sggByCode.get(targetSgg)?.parent_code : undefined;

  const localSgg = (e: SigunguLite): boolean =>
    e.sido_code === targetSido &&
    (targetSgg === undefined || e.code === targetSgg || e.code === targetParent || e.parent_code === targetSgg);
  const exactSgg = (e: SigunguLite): boolean =>
    targetSgg === undefined ? e.sido_code === targetSido : e.code === targetSgg || e.parent_code === targetSgg;

  const sidos = new Set<string>();
  const lists: SigunguLite[][] = [];
  for (const t of targetTokens) {
    const sido = lookup(idx.sidoByToken, t);
    if (sido !== undefined) sidos.add(sido);
    const list = lookup(idx.sggByToken, t);
    if (list !== undefined) lists.push(list);
  }

  const sggLocal = lists.some((list) => list.some(localSgg));
  const sggExact = lists.some((list) => list.some(exactSgg));
  const sggOther = lists.some((list) => list.every((e) => !localSgg(e)));

  if (sidos.size > 0 && !sidos.has(targetSido as string)) return "other";
  if (sggOther && !sggExact) return "other";
  if (sggLocal) return "local";
  if (targetSido !== undefined && sidos.has(targetSido)) return "local";
  return "national";
}

const REGION_RANK: Record<RegionClass, number> = { local: 0, national: 1, other: 2 };

export function compareBenefits(a: Scored, b: Scored): number {
  const rankA = a.regionClass === undefined ? 0 : REGION_RANK[a.regionClass];
  const rankB = b.regionClass === undefined ? 0 : REGION_RANK[b.regionClass];
  if (rankA !== rankB) return rankA - rankB;
  if (a.score !== b.score) return b.score - a.score;
  const dateA = a.row.registeredAt ?? "";
  const dateB = b.row.registeredAt ?? "";
  if (dateA !== dateB) return dateA < dateB ? 1 : -1;
  if (a.row.id === b.row.id) return 0;
  return a.row.id < b.row.id ? -1 : 1;
}
