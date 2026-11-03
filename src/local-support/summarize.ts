import { asArray, isRecord } from "../clients/parse.js";
import { daysBetween, toEpochDay, tryParseDate } from "../date/civil-date.js";
import type { CivilDate } from "../date/civil-date.js";

export const LCGV_QUOTE_MAX = 200;
export const LCGV_STALE_DAYS = 365;
export const LCGV_QUOTE_SUFFIX = "…(원문 일부)";
export const LCGV_SIDO_COMMON_IN_SGG = false;
export const LCGV_APPLY_ACTION =
  "공공데이터포털에서 '한국사회보장정보원_지자체복지서비스'(https://www.data.go.kr/data/15108347/openapi.do) 활용신청을 하면 자동승인돼요. 승인 후 같은 DATA_GO_KR_SERVICE_KEY로 쓸 수 있어요.";

export interface LcgvRow {
  servId: string;
  name: string;
  ctpv?: string;
  sgg?: string;
  dept?: string;
  cycle?: string;
  provision?: string;
  applyMethod?: string;
  digest?: string;
  lifeNames?: string;
  themes?: string;
  lastMod?: CivilDate;
  link?: string;
}

export interface LcgvDetail {
  servId?: string;
  target?: string;
  criteria?: string;
  content?: string;
  applyText?: string;
  contacts: { name: string; value?: string }[];
  laws: string[];
}

export type LcgvScope = "시군구" | "시도 공통";

function str(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t === "" ? undefined : t;
}

function omitUndefined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

export function toLcgvRow(item: Record<string, unknown>): LcgvRow | undefined {
  const servId = str(item.servId);
  const name = str(item.servNm);
  if (servId === undefined || name === undefined) return undefined;
  const m = str(item.lastModYmd);
  return omitUndefined({
    servId,
    name,
    ctpv: str(item.ctpvNm),
    sgg: str(item.sggNm),
    dept: str(item.bizChrDeptNm),
    cycle: str(item.sprtCycNm),
    provision: str(item.srvPvsnNm),
    applyMethod: str(item.aplyMtdNm),
    digest: str(item.servDgst),
    lifeNames: str(item.lifeNmArray),
    themes: str(item.intrsThemaNmArray),
    lastMod: m !== undefined && /^\d{8}$/.test(m) ? tryParseDate(m) : undefined,
    link: str(item.servDtlLink),
  });
}

export function toLcgvDetail(item: Record<string, unknown>): LcgvDetail {
  const contacts: LcgvDetail["contacts"] = [];
  for (const c of asArray(item.inqplCtadrList).filter(isRecord)) {
    const name = str(c.wlfareInfoReldNm);
    if (name === undefined) continue;
    const value = str(c.wlfareInfoReldCn);
    contacts.push(value === undefined ? { name } : { name, value });
  }
  const laws = asArray(item.baslawList)
    .filter(isRecord)
    .map((l) => str(l.wlfareInfoReldNm))
    .filter((v): v is string => v !== undefined);
  return {
    ...omitUndefined({
      servId: str(item.servId),
      target: str(item.sprtTrgtCn),
      criteria: str(item.slctCritCn),
      content: str(item.alwServCn),
      applyText: str(item.aplyMtdCn),
    }),
    contacts,
    laws,
  };
}

export function quote(text: string | undefined, max = LCGV_QUOTE_MAX): string | undefined {
  const t = text?.normalize("NFC").replace(/\s+/g, " ").trim();
  if (!t) return undefined;
  const cps = Array.from(t);
  if (cps.length <= max) return t;
  return cps.slice(0, max).join("") + LCGV_QUOTE_SUFFIX;
}

export function isStale(
  lastMod: CivilDate | undefined,
  today: CivilDate,
  days = LCGV_STALE_DAYS,
): boolean | undefined {
  if (lastMod === undefined) return undefined;
  return daysBetween(lastMod, today) > days;
}

export function scopeOf(row: Pick<LcgvRow, "sgg">, q: { sggNm?: string }): LcgvScope {
  return q.sggNm !== undefined && row.sgg === undefined ? "시도 공통" : "시군구";
}

export function compareLcgv(q: { sggNm?: string }): (a: LcgvRow, b: LcgvRow) => number {
  const rank = (r: LcgvRow): number => (scopeOf(r, q) === "시군구" ? 0 : 1);
  return (a, b) => {
    const byScope = rank(a) - rank(b);
    if (byScope !== 0) return byScope;
    if (a.lastMod !== undefined && b.lastMod !== undefined) {
      const byMod = toEpochDay(b.lastMod) - toEpochDay(a.lastMod);
      if (byMod !== 0) return byMod;
    } else if (a.lastMod !== undefined) {
      return -1;
    } else if (b.lastMod !== undefined) {
      return 1;
    }
    return a.servId < b.servId ? -1 : a.servId > b.servId ? 1 : 0;
  };
}

export function sidoCommonMayBeMissing(
  rows: readonly Pick<LcgvRow, "sgg">[],
  q: { sggNm?: string },
  includedInSgg = LCGV_SIDO_COMMON_IN_SGG,
): boolean {
  return !includedInSgg && q.sggNm !== undefined && rows.every((r) => scopeOf(r, q) === "시군구");
}
