import type { RegionResult } from "../../src/region/normalize.js";
import { applyCorrections, type HealthCenterCorrection } from "./health-center-corrections.js";
import {
  compareCenters,
  HEALTH_CENTER_BASIS_ID,
  HEALTH_CENTER_KINDS,
  HEALTH_CENTER_PRIMARY_KINDS,
  HEALTH_CENTER_SOURCES,
  type HealthCenterEntry,
  type HealthCenterKind,
  type HealthCentersFile,
  type SidoEntry,
  type SigunguEntry,
} from "../../src/data-store/schema.js";

export function decodeCsvBytes(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder("euc-kr").decode(bytes);
  }
  return text.replace(/^﻿/, "");
}

export function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;

  const endField = (): void => {
    record.push(field);
    field = "";
  };
  const endRecord = (): void => {
    endField();
    if (record.some((cell) => cell !== "")) records.push(record);
    record = [];
  };

  while (i < text.length) {
    const ch = text[i] ?? "";
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      endField();
      i += 1;
      continue;
    }
    if (ch === "\r" && text[i + 1] === "\n") {
      endRecord();
      i += 2;
      continue;
    }
    if (ch === "\n") {
      endRecord();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (field !== "" || record.length > 0) endRecord();
  return records;
}

export const HEADER_MAP = {
  name: "보건기관명",
  sido: "시도명",
  sigungu: "시군구명",
  kind: "보건기관유형명",
  roadAddress: "소재지도로명주소",
  lotAddress: "소재지지번주소",
  homepage: "홈페이지주소",
  phone: "전화번호",
} as const;

export const OPTIONAL_HEADER_MAP = { dataDate: "데이터기준일자" } as const;
// 진료검진내용 열은 사업 제공 여부를 단정하지 않기 위해 읽지 않는다(R87).

export const SOURCE_PROFILE_IDS = ["15107750", "3072692"] as const;
export type SourceProfileId = (typeof SOURCE_PROFILE_IDS)[number];
export interface SourceProfile<K extends SourceProfileId = SourceProfileId> {
  headers: Readonly<Partial<Record<keyof typeof HEADER_MAP, string>>>;
  optional: Readonly<Partial<Record<"lotAddress" | "dataDate", string>>>;
  kindMap: Readonly<Record<string, HealthCenterKind | null>>;
  source: (typeof HEALTH_CENTER_SOURCES)[K];
}
export const SOURCE_PROFILES: { readonly [K in SourceProfileId]: SourceProfile<K> } = {
  "15107750": {
    headers: HEADER_MAP,
    optional: OPTIONAL_HEADER_MAP,
    kindMap: { 보건소: "보건소", 보건의료원: "보건의료원", 보건지소: "보건지소", 보건진료소: "보건진료소" },
    source: HEALTH_CENTER_SOURCES["15107750"],
  },
  "3072692": {
    headers: { name: "보건기관명", sido: "시도", sigungu: "시군구", kind: "기관유형", roadAddress: "주소", homepage: "홈페이지 주소", phone: "대표 전화번호" },
    optional: {},
    kindMap: {
      보건소: "보건소",
      보건의료원: "보건의료원",
      일반보건지소: "보건지소",
      통합보건지소: "보건지소",
      보건진료소: "보건진료소",
      건강생활지원센터: null,
    },
    source: HEALTH_CENTER_SOURCES["3072692"],
  },
};

export interface SourceRow {
  row: number;
  name: string;
  sido: string;
  sigungu: string;
  kind: string;
  roadAddress: string;
  lotAddress: string;
  homepage: string;
  phone: string;
  dataDate: string;
}

export class HeaderError extends Error {
  constructor(
    readonly missing: string[],
    readonly found: string[],
    readonly byProfile?: Readonly<Record<SourceProfileId, string[]>>,
  ) {
    super(
      byProfile === undefined
        ? `필수 열을 찾지 못했어요: ${missing.join(", ")}. 찾은 열: ${found.join(", ")}`
        : `필수 열을 찾지 못했어요(원본 형식을 하나로 정하지 못했어요). ${SOURCE_PROFILE_IDS.map((id) => `${id} 빠진 열: ${byProfile[id].length > 0 ? byProfile[id].join(", ") : "없음"}`).join(" · ")}. 찾은 열: ${found.join(", ")}`,
    );
  }
}

function cleanHeader(cell: string): string {
  return cell.replace(/﻿/g, "").trim();
}

export function detectProfile(header: readonly string[]): SourceProfileId {
  const cleaned = header.map(cleanHeader);
  const byProfile = Object.fromEntries(
    SOURCE_PROFILE_IDS.map((id) => [id, Object.values(SOURCE_PROFILES[id].headers).filter((h) => !cleaned.includes(h))]),
  ) as Record<SourceProfileId, string[]>;
  const complete = SOURCE_PROFILE_IDS.filter((id) => byProfile[id].length === 0);
  const [only] = complete;
  if (complete.length === 1 && only !== undefined) return only;
  const closest = SOURCE_PROFILE_IDS.reduce((best, id) => (byProfile[id].length < byProfile[best].length ? id : best));
  throw new HeaderError(byProfile[closest], cleaned, byProfile);
}

export function readSourceTable(table: string[][]): {
  profile: SourceProfileId;
  rows: SourceRow[];
  excludedKinds: Record<string, number>;
} {
  const header = (table[0] ?? []).map(cleanHeader);
  const profile = detectProfile(header);
  const p: SourceProfile = SOURCE_PROFILES[profile];

  const cell = (record: string[], name: string | undefined): string => {
    if (name === undefined) return "";
    const index = header.indexOf(name);
    return (index < 0 ? "" : (record[index] ?? "")).normalize("NFKC").trim();
  };

  const rows: SourceRow[] = [];
  const excludedKinds: Record<string, number> = {};
  table.slice(1).forEach((record, i) => {
    const rawKind = cell(record, p.headers.kind);
    const mapped = Object.hasOwn(p.kindMap, rawKind) ? (p.kindMap[rawKind] as HealthCenterKind | null) : rawKind;
    if (mapped === null) {
      excludedKinds[rawKind] = (excludedKinds[rawKind] ?? 0) + 1;
      return;
    }
    rows.push({
      row: i + 1,
      name: cell(record, p.headers.name),
      sido: cell(record, p.headers.sido),
      sigungu: cell(record, p.headers.sigungu),
      kind: mapped,
      roadAddress: cell(record, p.headers.roadAddress),
      lotAddress: cell(record, p.headers.lotAddress ?? p.optional.lotAddress),
      homepage: cell(record, p.headers.homepage),
      phone: cell(record, p.headers.phone),
      dataDate: cell(record, p.optional.dataDate),
    });
  });
  return { profile, rows, excludedKinds };
}

export function toSourceRows(table: string[][]): SourceRow[] {
  return readSourceTable(table).rows;
}

export interface RegionLookup {
  normalize: (input: string) => RegionResult;
  sido: readonly SidoEntry[];
  sigungu: readonly SigunguEntry[];
}

const NO_SIGUNGU = new Set(["", "없음"]);

function compact(s: string): string {
  return s.normalize("NFKC").replace(/\s+/g, "");
}

function guName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1] ?? name;
}

function rowLabel(row: SourceRow): string {
  return `${row.row}번째 행 ${row.name} (${row.sido} ${row.sigungu})`;
}

export function matchRegion(row: SourceRow, lookup: RegionLookup): { code: string } | { unmatched: string } {
  const label = rowLabel(row);
  const sidoResult = lookup.normalize(row.sido);
  const sidoEntry =
    sidoResult.ok && sidoResult.region.code === undefined
      ? lookup.sido.find((s) => s.name === sidoResult.region.sido)
      : undefined;
  const sameAsSido =
    sidoEntry !== undefined && [sidoEntry.name, ...sidoEntry.aliases].some((n) => compact(n) === compact(row.sigungu));
  if (NO_SIGUNGU.has(row.sigungu) || sameAsSido) {
    if (sidoEntry !== undefined) {
      const kids = lookup.sigungu.filter((g) => g.sido_code === sidoEntry.code);
      const [only] = kids;
      if (kids.length === 1 && only) return { code: only.code };
    }
    if (sameAsSido) return { unmatched: `${label}: 시군구 값이 시도 이름과 같아요(시군구가 여럿인 시도)` };
    return {
      unmatched:
        row.sigungu === ""
          ? `${label}: 시군구명이 비어 있어요`
          : `${label}: 시군구명이 '없음'이에요(시군구가 여럿인 시도)`,
    };
  }

  const r = lookup.normalize(`${row.sido} ${row.sigungu}`);
  if (!r.ok && r.abolished !== undefined) return { unmatched: `${label}: 폐지된 지역이에요(${r.abolished.on})` };
  const code = r.ok ? r.region.code : undefined;
  if (code === undefined) {
    return { unmatched: `${label}: 지역을 찾지 못했어요(${r.ok ? "시도만 일치" : r.message})` };
  }

  const children = lookup.sigungu.filter((g) => g.parent_code === code);
  if (children.length === 0) return { code };

  const name = compact(row.name);
  const hits = children.filter((g) => name.includes(compact(guName(g.name))));
  const [only] = hits;
  if (hits.length === 0) return { code };
  if (hits.length === 1 && only) return { code: only.code };
  return { unmatched: `${label}: 기관명에 구 이름이 여러 개예요(${hits.map((g) => guName(g.name)).join(", ")})` };
}

export interface BuildOptions {
  lookup: RegionLookup;
  sourceModified: string;
  asOf: string;
  generatedAt: string;
  fileName: string;
  profile?: SourceProfileId;
  excludedKinds?: Readonly<Record<string, number>>;
  corrections?: readonly HealthCenterCorrection[];
}

export interface BuildReport {
  unmatched: string[];
  multiplePrimary: string[];
  fieldIssues: string[];
  added: number;
  removed: number;
  changed: number;
  dataDateRange: { min: string; max: string } | null;
  coverage: { units: number; covered: number; missing: string[] };
  profile: SourceProfileId;
  excludedKinds: Record<string, number>;
  corrections: { applied: string[]; stale: string[] };
}

const PHONE_RE = /^[0-9-]{7,15}$/;
const HOMEPAGE_RE = /^https?:\/\/\S+$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const COMPACT_DATE_RE = /^(\d{4})(\d{2})(\d{2})$/;
const joinParts = (...parts: string[]): string => parts.join("");
/** PAC39 파일 층 패턴 7개. 조각을 이어 만들어 이 파일도 같은 검사를 통과한다. test/helpers/affiliation-wording.ts 의 목록과 같아야 한다(테스트로 고정). */
export const WORDING_PATTERNS: readonly RegExp[] = [
  new RegExp(joinParts("비", "공식")),
  new RegExp(joinParts("un", "official"), "i"),
  new RegExp(joinParts("비", "제휴")),
  new RegExp(joinParts("무", "관")),
  new RegExp(joinParts("관계", "없는")),
  new RegExp(joinParts("개인", " 프로젝트")),
  new RegExp([joinParts("아", "니"), joinParts("아", "닌"), joinParts("아", "님"), joinParts("아", "닙")].join("|")),
];
/** 항목의 기관명·주소·전화·홈페이지 중 패턴에 걸리는 첫 필드 이름. 없으면 undefined. */
export function wordingField(entry: HealthCenterEntry): "기관명" | "주소" | "전화번호" | "홈페이지" | undefined {
  const fields: ["기관명" | "주소" | "전화번호" | "홈페이지", string | undefined][] = [
    ["기관명", entry.name],
    ["주소", entry.address],
    ["전화번호", entry.phone],
    ["홈페이지", entry.homepage],
  ];
  for (const [label, value] of fields) {
    if (value !== undefined && WORDING_PATTERNS.some((p) => p.test(value))) return label;
  }
  return undefined;
}
export function coverageNote(covered: number, units: number): string | undefined {
  return covered < units ? `주 기관 확인 지역 ${covered}/${units}곳. 목록에 없는 지역은 안내 링크로 대신해요` : undefined;
}

function isKind(value: string): value is HealthCenterKind {
  return (HEALTH_CENTER_KINDS as readonly string[]).includes(value);
}

function isPrimary(entry: HealthCenterEntry): boolean {
  return (HEALTH_CENTER_PRIMARY_KINDS as readonly string[]).includes(entry.kind);
}

function keyOf(entry: { code: string; kind: string; name: string }): string {
  return `${entry.code}|${entry.kind}|${entry.name}`;
}

function normalizeDate(raw: string): string | undefined {
  const compactMatch = COMPACT_DATE_RE.exec(raw);
  const s = compactMatch ? `${compactMatch[1]}-${compactMatch[2]}-${compactMatch[3]}` : raw;
  const m = DATE_RE.exec(s);
  if (!m) return undefined;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return undefined;
  return s;
}

function toEntry(row: SourceRow, code: string, label: string, fieldIssues: string[]): HealthCenterEntry {
  const phoneRaw = row.phone;
  const phoneClean = phoneRaw.replace(/\s+/g, "");
  let phone: string | undefined;
  if (phoneClean !== "") {
    if (PHONE_RE.test(phoneClean)) phone = phoneClean;
    else fieldIssues.push(`${label}: 전화번호 형식을 확인하세요(${phoneRaw})`);
  }

  let homepage: string | undefined;
  if (row.homepage !== "") {
    if (HOMEPAGE_RE.test(row.homepage)) homepage = row.homepage;
    else fieldIssues.push(`${label}: 홈페이지 주소 형식을 확인하세요(${row.homepage})`);
  }

  const address = row.roadAddress || row.lotAddress || undefined;

  let sourceDate: string | undefined;
  if (row.dataDate !== "") {
    sourceDate = normalizeDate(row.dataDate);
    if (sourceDate === undefined) fieldIssues.push(`${label}: 데이터기준일자 형식을 확인하세요(${row.dataDate})`);
  }

  return {
    code,
    name: row.name,
    kind: row.kind as HealthCenterKind,
    ...(phone !== undefined ? { phone } : {}),
    ...(homepage !== undefined ? { homepage } : {}),
    ...(address !== undefined ? { address } : {}),
    ...(sourceDate !== undefined ? { source_date: sourceDate } : {}),
    verified: "partial",
  };
}

export function buildHealthCenters(
  rows: readonly SourceRow[],
  prev: HealthCentersFile | undefined,
  opts: BuildOptions,
): { data: HealthCentersFile; report: BuildReport } {
  const unmatched: string[] = [];
  const multiplePrimary: string[] = [];
  const fieldIssues: string[] = [];

  const dates = rows
    .map((row) => normalizeDate(row.dataDate))
    .filter((d): d is string => d !== undefined)
    .sort();
  const firstDate = dates[0];
  const lastDate = dates.at(-1);
  const dataDateRange = firstDate !== undefined && lastDate !== undefined ? { min: firstDate, max: lastDate } : null;

  const profile: SourceProfileId = opts.profile ?? "15107750";
  const excludedKinds: Record<string, number> = { ...(opts.excludedKinds ?? {}) };
  const excludedTotal = Object.values(excludedKinds).reduce((sum, n) => sum + n, 0);

  const seen = new Set<string>();
  const matched: HealthCenterEntry[] = [];
  for (const row of rows) {
    const label = rowLabel(row);
    if (!isKind(row.kind)) {
      unmatched.push(`${label}: 유형 값을 확인하세요(${row.kind})`);
      continue;
    }
    const m = matchRegion(row, opts.lookup);
    if ("unmatched" in m) {
      unmatched.push(m.unmatched);
      continue;
    }
    const key = `${m.code}|${row.kind}|${row.name}`;
    if (seen.has(key)) {
      fieldIssues.push(`${label}: 같은 이름·유형 항목이 여러 개예요(앞 행만 남겼어요)`);
      continue;
    }
    seen.add(key);
    const entry = toEntry(row, m.code, label, fieldIssues);
    const field = wordingField(entry);
    if (field !== undefined) {
      fieldIssues.push(`${label}: ${field} 문구가 표현 기준(PAC39) 검토 대상이라 원문을 고치지 않고 목록에서 뺐어요`);
      continue;
    }
    matched.push(entry);
  }

  const primariesByCode = new Map<string, HealthCenterEntry[]>();
  const secondariesByCode = new Map<string, HealthCenterEntry[]>();
  for (const entry of matched) {
    const target = isPrimary(entry) ? primariesByCode : secondariesByCode;
    const list = target.get(entry.code) ?? [];
    list.push(entry);
    target.set(entry.code, list);
  }

  const sortedPrimaryCodes = [...primariesByCode.keys()].sort();
  for (const code of sortedPrimaryCodes) {
    const list = primariesByCode.get(code) ?? [];
    if (list.length >= 2) {
      multiplePrimary.push(`${code}: ${list.map((e) => e.name).sort().join(", ")}`);
    }
  }

  const kept: HealthCenterEntry[] = matched.filter(isPrimary);
  for (const [code, list] of secondariesByCode) {
    if (primariesByCode.has(code)) continue;
    const parent = opts.lookup.sigungu.find((g) => g.code === code)?.parent_code;
    if (parent !== undefined && primariesByCode.has(parent)) continue;
    kept.push(...[...list].sort(compareCenters).slice(0, 3));
  }

  kept.sort(compareCenters);

  const prevByKey = new Map<string, HealthCenterEntry>();
  for (const old of prev?.centers ?? []) prevByKey.set(keyOf(old), old);

  const inherited: HealthCenterEntry[] = kept.map((entry) => {
    const old = prevByKey.get(keyOf(entry));
    if (old === undefined || old.phone !== entry.phone || old.homepage !== entry.homepage) return entry;
    return {
      ...entry,
      verified: old.verified,
      ...(old.verified_by !== undefined ? { verified_by: old.verified_by } : {}),
      ...(old.verified_on !== undefined ? { verified_on: old.verified_on } : {}),
    };
  });
  const corrected = applyCorrections(inherited, opts.corrections ?? []);
  const centers = corrected.entries;

  const newKeys = new Set(centers.map(keyOf));
  let added = 0;
  let changed = 0;
  let correctionOnly = 0;
  centers.forEach((entry, i) => {
    const old = prevByKey.get(keyOf(entry));
    if (old === undefined) {
      added += 1;
      return;
    }
    if (
      old.phone !== entry.phone ||
      old.homepage !== entry.homepage ||
      old.address !== entry.address ||
      old.source_date !== entry.source_date
    ) {
      changed += 1;
      const inheritedEntry = inherited[i];
      if (
        inheritedEntry !== undefined &&
        inheritedEntry.phone !== entry.phone &&
        old.phone === inheritedEntry.phone &&
        old.homepage === entry.homepage &&
        old.address === entry.address &&
        old.source_date === entry.source_date
      ) {
        correctionOnly += 1;
      }
    }
  });
  let removed = 0;
  for (const key of prevByKey.keys()) {
    if (!newKeys.has(key)) removed += 1;
  }

  const carried = prev !== undefined && added + removed + changed - correctionOnly === 0 ? prev : undefined;

  // coverage: 주 기관(보건소·보건의료원)이 그 코드·상위 시·하위 구 중 한 곳에 있는 시군구 수. 원본이 전국을 담는지 확인하는 용도.
  const primary = new Set(centers.filter(isPrimary).map((c) => c.code));
  const parents = new Set(
    opts.lookup.sigungu
      .filter((g) => g.parent_code !== undefined && primary.has(g.code))
      .map((g) => g.parent_code as string),
  );
  const uncovered = opts.lookup.sigungu.filter(
    (g) => !(primary.has(g.code) || (g.parent_code !== undefined && primary.has(g.parent_code)) || parents.has(g.code)),
  );
  const missing = [...uncovered]
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
    .map((g) => {
      const sidoName = opts.lookup.sido.find((s) => s.code === g.sido_code)?.name ?? g.sido_code;
      return `${sidoName} ${g.name}(${g.code})`;
    });
  const coverage = { units: opts.lookup.sigungu.length, covered: opts.lookup.sigungu.length - uncovered.length, missing };
  const note = coverageNote(coverage.covered, coverage.units);

  const data: HealthCentersFile = {
    source: {
      ...SOURCE_PROFILES[profile].source,
      license: prev?.source.license ?? null,
      source_modified: opts.sourceModified,
      file_name: opts.fileName,
    },
    generated_at: carried?.generated_at ?? opts.generatedAt,
    as_of: opts.asOf,
    basis_ids: [HEALTH_CENTER_BASIS_ID],
    verified: carried?.verified ?? "partial",
    ...(carried?.verified_by !== undefined ? { verified_by: carried.verified_by } : {}),
    ...(carried?.verified_on !== undefined ? { verified_on: carried.verified_on } : {}),
    ...(note !== undefined ? { note } : {}),
    counts: { source_rows: rows.length + excludedTotal, kept: centers.length, unmatched: unmatched.length },
    centers,
  };

  return {
    data,
    report: {
      unmatched,
      multiplePrimary,
      fieldIssues,
      added,
      removed,
      changed,
      dataDateRange,
      coverage,
      profile,
      excludedKinds,
      corrections: { applied: corrected.applied, stale: corrected.stale },
    },
  };
}
