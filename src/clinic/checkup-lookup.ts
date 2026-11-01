import { callDataGoKr } from "../clients/data-go-kr.js";
import { SPECS } from "../clients/data-go-kr-specs.js";
import type { ToolContext } from "../core/context.js";
import type { Region } from "../region/normalize.js";

export const CHECKUP_PAGE_ROWS = 1000;
export const CHECKUP_LIMITS = { infant: 10, oral: 5 } as const;
/** M41 기록(2026-11-01): regions.json에 있으나 검진기관 API 시군구 목록에는 구 단위로만 있는 시 단위 코드. */
export const CHECKUP_UNQUERYABLE_CODES: ReadonlySet<string> = new Set([
  "41110", "41130", "41170", "41190", "41270", "41280", "41460", "41590",
  "43110", "44130", "47110", "48120", "52110",
]);

export type CheckupRegionCheck =
  | { ok: true; siDoCd: string; siGunGuCd: string }
  | { ok: false; reason: "sido-only" | "city-split" };

export interface CheckupClinic {
  name: string;
  kind?: string;
  address?: string;
  phone?: string;
  infant: boolean;
  oral: boolean;
}

export interface CheckupLookup {
  items: CheckupClinic[];
  total: number;
  fetched: number;
}

export function checkupRegionParams(region: Region): CheckupRegionCheck {
  const code = region.code;
  if (code === undefined || !/^\d{5}$/.test(code) || code.slice(2) === "000") {
    return { ok: false, reason: "sido-only" };
  }
  if (CHECKUP_UNQUERYABLE_CODES.has(code)) {
    return { ok: false, reason: "city-split" };
  }
  return { ok: true, siDoCd: code.slice(0, 2), siGunGuCd: code.slice(2) };
}

export function toCheckupClinic(item: Record<string, unknown>): CheckupClinic | undefined {
  const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  const tel = (v: unknown): string => str(v).replace(/^-+/, "");
  const name = str(item.hmcNm);
  if (name === "") return undefined;
  const clinic: CheckupClinic = {
    name,
    infant: str(item.ichkChrgTypeCd) === "1",
    oral: str(item.mchkChrgTypeCd) === "1",
  };
  const kind = str(item.ykindnm);
  if (kind !== "") clinic.kind = kind;
  const address = str(item.locAddr);
  if (address !== "") clinic.address = address;
  const phone = tel(item.hmcTelNo) || tel(item.exmdrTelNo);
  if (phone !== "") clinic.phone = phone;
  return clinic;
}

export async function lookupCheckupClinics(
  ctx: ToolContext,
  params: { siDoCd: string; siGunGuCd: string },
): Promise<CheckupLookup> {
  const r = await callDataGoKr(
    SPECS.checkupClinic,
    { siDoCd: params.siDoCd, siGunGuCd: params.siGunGuCd, pageNo: 1, numOfRows: CHECKUP_PAGE_ROWS },
    ctx,
  );
  const items = r.items
    .map(toCheckupClinic)
    .filter((c): c is CheckupClinic => c !== undefined);
  return { items, total: r.totalCount ?? r.items.length, fetched: r.items.length };
}
