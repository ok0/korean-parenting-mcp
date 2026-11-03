import type { RegionResult } from "../../src/region/normalize.js";
import {
  compareCenters,
  HEALTH_CENTER_BASIS_ID,
  HEALTH_CENTER_KINDS,
  HEALTH_CENTER_PRIMARY_KINDS,
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
  ) {
    super(`필수 열을 찾지 못했어요: ${missing.join(", ")}. 찾은 열: ${found.join(", ")}`);
  }
}

function cleanHeader(cell: string): string {
  return cell.replace(/﻿/g, "").trim();
}

export function toSourceRows(table: string[][]): SourceRow[] {
  const header = (table[0] ?? []).map(cleanHeader);
  const missing = Object.values(HEADER_MAP).filter((name) => !header.includes(name));
  if (missing.length > 0) throw new HeaderError(missing, header);

  const cell = (record: string[], name: string): string => {
    const index = header.indexOf(name);
    return (index < 0 ? "" : (record[index] ?? "")).normalize("NFKC").trim();
  };

  return table.slice(1).map((record, i) => ({
    row: i + 1,
    name: cell(record, HEADER_MAP.name),
    sido: cell(record, HEADER_MAP.sido),
    sigungu: cell(record, HEADER_MAP.sigungu),
    kind: cell(record, HEADER_MAP.kind),
    roadAddress: cell(record, HEADER_MAP.roadAddress),
    lotAddress: cell(record, HEADER_MAP.lotAddress),
    homepage: cell(record, HEADER_MAP.homepage),
    phone: cell(record, HEADER_MAP.phone),
    dataDate: cell(record, OPTIONAL_HEADER_MAP.dataDate),
  }));
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
  if (NO_SIGUNGU.has(row.sigungu)) {
    const sidoResult = lookup.normalize(row.sido);
    if (sidoResult.ok && sidoResult.region.code === undefined) {
      const sidoName = sidoResult.region.sido;
      const sido = lookup.sido.find((s) => s.name === sidoName);
      const kids = sido ? lookup.sigungu.filter((g) => g.sido_code === sido.code) : [];
      const [only] = kids;
      if (kids.length === 1 && only) return { code: only.code };
    }
    return {
      unmatched:
        row.sigungu === ""
          ? `${label}: 시군구명이 비어 있어요`
          : `${label}: 시군구명이 '없음'이에요(시군구가 여럿인 시도)`,
    };
  }

  const r = lookup.normalize(`${row.sido} ${row.sigungu}`);
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
}

const PHONE_RE = /^[0-9-]{7,15}$/;
const HOMEPAGE_RE = /^https?:\/\/\S+$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const COMPACT_DATE_RE = /^(\d{4})(\d{2})(\d{2})$/;

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
    matched.push(toEntry(row, m.code, label, fieldIssues));
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
  const deduped: HealthCenterEntry[] = [];
  for (const entry of kept) {
    const last = deduped.at(-1);
    if (last !== undefined && compareCenters(last, entry) === 0) {
      fieldIssues.push(`${entry.code} ${entry.name}: 같은 이름·유형 항목이 여러 개예요`);
      continue;
    }
    deduped.push(entry);
  }

  const prevByKey = new Map<string, HealthCenterEntry>();
  for (const old of prev?.centers ?? []) prevByKey.set(keyOf(old), old);

  const centers: HealthCenterEntry[] = deduped.map((entry) => {
    const old = prevByKey.get(keyOf(entry));
    if (old === undefined || old.phone !== entry.phone || old.homepage !== entry.homepage) return entry;
    return {
      ...entry,
      verified: old.verified,
      ...(old.verified_by !== undefined ? { verified_by: old.verified_by } : {}),
      ...(old.verified_on !== undefined ? { verified_on: old.verified_on } : {}),
    };
  });

  const newKeys = new Set(centers.map(keyOf));
  let added = 0;
  let changed = 0;
  for (const entry of centers) {
    const old = prevByKey.get(keyOf(entry));
    if (old === undefined) {
      added += 1;
      continue;
    }
    if (
      old.phone !== entry.phone ||
      old.homepage !== entry.homepage ||
      old.address !== entry.address ||
      old.source_date !== entry.source_date
    ) {
      changed += 1;
    }
  }
  let removed = 0;
  for (const key of prevByKey.keys()) {
    if (!newKeys.has(key)) removed += 1;
  }

  const carried = prev !== undefined && added + removed + changed === 0 ? prev : undefined;

  const data: HealthCentersFile = {
    source: {
      dataset_id: "15107750",
      title: "전국보건기관표준데이터",
      url: "https://www.data.go.kr/data/15107750/standard.do",
      provider: "지방자치단체",
      license: prev?.source.license ?? null,
      source_modified: opts.sourceModified,
      file_name: opts.fileName,
    },
    generated_at: opts.generatedAt,
    as_of: opts.asOf,
    basis_ids: [HEALTH_CENTER_BASIS_ID],
    verified: carried?.verified ?? "partial",
    ...(carried?.verified_by !== undefined ? { verified_by: carried.verified_by } : {}),
    ...(carried?.verified_on !== undefined ? { verified_on: carried.verified_on } : {}),
    counts: { source_rows: rows.length, kept: centers.length, unmatched: unmatched.length },
    centers,
  };

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

  return {
    data,
    report: { unmatched, multiplePrimary, fieldIssues, added, removed, changed, dataDateRange, coverage },
  };
}
