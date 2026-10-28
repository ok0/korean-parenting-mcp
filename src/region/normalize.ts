import { loadData } from "../data-store/load.js";
import type { AbolishedRegion, SidoEntry, SigunguEntry } from "../data-store/schema.js";

export interface Region {
  sido: string;
  sigungu?: string;
  code?: string;
}

export type RegionResult =
  | { ok: true; region: Region }
  | {
      ok: false;
      reason: "ambiguous" | "unknown";
      candidates: Region[];
      message: string;
      abolished?: { name: string; on: string };
    };

export const REGION_INPUT_MAX = 100;

const MSG_EMPTY = "지역을 입력하세요. 시군구 단위로 입력합니다(예: 성동구, 수원시 영통구).";
const MSG_TOO_LONG = "지역 입력이 너무 깁니다(100자 이하). 예: 성동구, 수원시 영통구";
const MSG_SUBGU = "구 단위로 입력하세요(동·읍·면·도로명 단위는 지원하지 않습니다). 예: 성동구, 수원시 영통구";
const MSG_UNKNOWN = "알 수 없는 지역입니다. 시도·시군구 이름을 확인하세요. 예: 성동구, 수원시 영통구, 서울";

function compact(s: string): string {
  return s.normalize("NFKC").replace(/\s+/g, "");
}

interface Index {
  sidoByCode: Map<string, SidoEntry>;
  sidoByAlias: Map<string, SidoEntry>;
  sidoPrefixes: [string, SidoEntry][];
  sggByCode: Map<string, SigunguEntry>;
  sggByKey: Map<string, SigunguEntry[]>;
  abolished: AbolishedRegion[];
}

let memo: Index | undefined;

function index(): Index {
  if (memo) return memo;
  const data = loadData("regions");
  const sidoByCode = new Map<string, SidoEntry>();
  const sidoByAlias = new Map<string, SidoEntry>();
  for (const s of data.sido) {
    sidoByCode.set(s.code, s);
    for (const alias of [s.name, ...s.aliases]) {
      sidoByAlias.set(compact(alias), s);
    }
  }
  const sidoPrefixes = [...sidoByAlias.entries()].sort((a, b) => b[0].length - a[0].length);
  const sggByCode = new Map<string, SigunguEntry>();
  const sggByKey = new Map<string, SigunguEntry[]>();
  for (const g of data.sigungu) {
    sggByCode.set(g.code, g);
    for (const key of new Set([g.name, ...g.aliases].map(compact))) {
      const list = sggByKey.get(key) ?? [];
      list.push(g);
      sggByKey.set(key, list);
    }
  }
  memo = { sidoByCode, sidoByAlias, sidoPrefixes, sggByCode, sggByKey, abolished: data.abolished };
  return memo;
}

function sidoName(idx: Index, code: string): string {
  return idx.sidoByCode.get(code)?.name ?? code;
}

function toRegion(idx: Index, g: SigunguEntry): Region {
  return { sido: sidoName(idx, g.sido_code), sigungu: g.name, code: g.code };
}

function distinctSigungu(list: SigunguEntry[]): SigunguEntry[] {
  const byCode = new Map<string, SigunguEntry>();
  for (const g of list) byCode.set(g.code, g);
  return [...byCode.values()].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}

function listText(candidates: Region[]): string {
  return candidates.map((c) => `${c.sido} ${c.sigungu ?? ""}`.trim()).join(", ");
}

function unknownResult(message: string, candidates: Region[] = []): RegionResult {
  return { ok: false, reason: "unknown", candidates, message };
}

function resolveIn(idx: Index, rest: string, sidoCode: string | undefined): RegionResult | null {
  const sidoMatches = (g: SigunguEntry): boolean => sidoCode === undefined || g.sido_code === sidoCode;

  const hits = distinctSigungu((idx.sggByKey.get(rest) ?? []).filter(sidoMatches));
  const [only] = hits;
  if (hits.length === 1 && only) {
    return { ok: true, region: toRegion(idx, only) };
  }
  if (hits.length >= 2) {
    const candidates = hits.map((g) => toRegion(idx, g));
    return {
      ok: false,
      reason: "ambiguous",
      candidates,
      message: `여러 지역에 같은 이름이 있습니다. 시도와 함께 입력하세요: ${listText(candidates)}`,
    };
  }

  for (const a of idx.abolished) {
    if (compact(a.name) !== rest) continue;
    if (sidoCode !== undefined && a.sido_code !== sidoCode) continue;
    const successors = distinctSigungu(
      a.successor_codes.flatMap((c) => {
        const g = idx.sggByCode.get(c);
        return g ? [g] : [];
      }),
    );
    const candidates = successors.map((g) => toRegion(idx, g));
    const sido = idx.sidoByCode.get(a.sido_code);
    const label = sido ? `${sido.name} ${a.name}` : a.name;
    return {
      ok: false,
      reason: "ambiguous",
      candidates,
      abolished: { name: label, on: a.abolished_on },
      message: `${label}은(는) ${a.abolished_on}에 폐지·개편되었습니다. 해당하는 지역을 골라 입력하세요: ${listText(candidates)}`,
    };
  }

  let bestLen = 0;
  let best: SigunguEntry[] = [];
  for (const [key, list] of idx.sggByKey) {
    if (key.length === 0 || key.length >= rest.length || !rest.startsWith(key)) continue;
    const filtered = list.filter(sidoMatches);
    if (filtered.length === 0) continue;
    if (key.length > bestLen) {
      bestLen = key.length;
      best = filtered;
    }
  }
  if (bestLen > 0) {
    return unknownResult(MSG_SUBGU, distinctSigungu(best).map((g) => toRegion(idx, g)));
  }

  return null;
}

export function normalizeRegion(input: string): RegionResult {
  if (typeof input !== "string") return unknownResult(MSG_EMPTY);
  const raw = input.normalize("NFKC").trim();
  if (raw === "") return unknownResult(MSG_EMPTY);
  if (raw.length > REGION_INPUT_MAX) return unknownResult(MSG_TOO_LONG);

  const idx = index();
  const s = compact(raw);

  const sido = idx.sidoByAlias.get(s);
  if (sido) return { ok: true, region: { sido: sido.name } };

  const prefix = idx.sidoPrefixes.find(([p]) => s.startsWith(p) && s.length > p.length);
  if (prefix) {
    const r = resolveIn(idx, s.slice(prefix[0].length), prefix[1].code);
    if (r) return r;
  }

  const direct = resolveIn(idx, s, undefined);
  if (direct) return direct;

  if (/(동|읍|면|리|가|로|길|번지)$|\d/.test(s)) return unknownResult(MSG_SUBGU);
  return unknownResult(MSG_UNKNOWN);
}
