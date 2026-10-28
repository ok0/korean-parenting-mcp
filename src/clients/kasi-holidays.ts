// SPECS.kasiHoliday는 M11 실응답(2026-10-28)으로 확인. XML 경로 유지(R17)
import { callDataGoKr } from "./data-go-kr.js";
import { SPECS } from "./data-go-kr-specs.js";
import type { ToolContext } from "../core/context.js";
import { ToolError } from "../core/errors.js";
import type { HolidayEntry } from "../date/holiday-sanity.js";

export const KASI_ROWS_PER_YEAR = 100;

export async function fetchKasiHolidays(year: number, ctx: ToolContext): Promise<HolidayEntry[]> {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new ToolError("BAD_INPUT", `공휴일 조회 연도 범위 밖: ${year}`);
  }
  const res = await callDataGoKr(SPECS.kasiHoliday, { solYear: year, pageNo: 1, numOfRows: KASI_ROWS_PER_YEAR }, ctx);
  if (res.totalCount !== undefined && res.totalCount > res.items.length) {
    throw new ToolError("UPSTREAM", `KASI 특일 응답이 잘렸습니다(전체 ${res.totalCount}건 중 ${res.items.length}건)`, {
      detail: { reason: "truncated" },
    });
  }
  const entries: HolidayEntry[] = [];
  for (const item of res.items) {
    if (String(item.isHoliday ?? "").trim() !== "Y") continue;
    const raw = String(item.locdate ?? "").trim();
    if (!/^\d{8}$/.test(raw)) {
      throw new ToolError("UPSTREAM", "KASI 특일 응답의 날짜 형식이 예상과 다릅니다", { detail: { reason: "format" } });
    }
    entries.push({
      date: `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`,
      name: String(item.dateName ?? "").trim(),
    });
  }
  entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const out: HolidayEntry[] = [];
  for (const e of entries) {
    if (out.length > 0 && out[out.length - 1]!.date === e.date) continue;
    out.push(e);
  }
  return out;
}
