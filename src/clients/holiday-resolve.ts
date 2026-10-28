import { cached } from "../core/cache.js";
import { CACHE_TTL_MS } from "../core/cache-ttl.js";
import type { ToolContext } from "../core/context.js";
import { ToolError } from "../core/errors.js";
import type { CivilDate } from "../date/civil-date.js";
import {
  bundledCalendar,
  createCalendar,
  holidayDiffNote,
  liveUnavailableNote,
  type HolidaySource,
  type ResolvedHolidayCalendar,
} from "../date/holiday-calendar.js";
import { checkHolidaySanity, type HolidayEntry } from "../date/holiday-sanity.js";
import { loadData } from "../data-store/load.js";
import { fetchKasiHolidays } from "./kasi-holidays.js";

export const KASI_YEAR_MIN = 2000;
export const KASI_YEAR_MAX = 2100;

export function formatKstMinute(d: Date): string {
  return new Date(d.getTime() + 9 * 3_600_000).toISOString().slice(0, 16).replace("T", " ");
}

type Outcome = { ok: true; entries: HolidayEntry[]; at: number } | { ok: false; kind: string };

export async function resolveHolidayCalendar(
  years: readonly number[],
  ctx: ToolContext,
  opts: { deadlineMs?: number; referenceDate?: CivilDate } = {},
): Promise<ResolvedHolidayCalendar> {
  const requested = [...new Set(years.filter((y) => Number.isInteger(y)))].sort((a, b) => a - b);
  const queryable = requested.filter((y) => y >= KASI_YEAR_MIN && y <= KASI_YEAR_MAX);
  const data = loadData("holidays");
  const base = bundledCalendar({ referenceDate: opts.referenceDate, data });
  if (!ctx.config.keys.DATA_GO_KR || queryable.length === 0) {
    return { ...base, requestedYears: requested };
  }
  try {
    const deadlineMs = opts.deadlineMs ?? ctx.config.lawCheckTimeoutMs;
    const callCtx: ToolContext = {
      ...ctx,
      config: { ...ctx.config, httpTimeoutMs: Math.min(ctx.config.httpTimeoutMs, deadlineMs) },
    };
    const outcomes = new Map<number, Outcome>();
    let closed = false;
    const tasks = queryable.map(async (y) => {
      try {
        const { value } = await cached(ctx, `kasi-live:${y}`, CACHE_TTL_MS.kasiHoliday, async () => ({
          entries: await fetchKasiHolidays(y, callCtx),
          at: ctx.clock.now().getTime(),
        }));
        if (!closed) outcomes.set(y, { ok: true, ...value });
      } catch (err) {
        if (!closed) outcomes.set(y, { ok: false, kind: err instanceof ToolError ? err.kind : "UPSTREAM" });
      }
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, deadlineMs);
      timer.unref?.();
    });
    try {
      await Promise.race([Promise.all(tasks), deadline]);
    } finally {
      closed = true;
      clearTimeout(timer);
    }

    const bundledYears = new Set<number>(data.covers_years);
    const yearsRec: Record<number, { source: HolidaySource; entries: readonly HolidayEntry[] }> = {};
    for (const y of data.covers_years) {
      yearsRec[y] = { source: "bundled", entries: data.years[String(y)] ?? [] };
    }
    const diffNotes: string[] = [];
    const failed: number[] = [];
    const liveAt: number[] = [];
    let notApproved = false;
    for (const y of queryable) {
      const o = outcomes.get(y);
      if (o?.ok && checkHolidaySanity(y, o.entries).ok) {
        if (bundledYears.has(y)) {
          const bundledDates = new Set((data.years[String(y)] ?? []).map((e) => e.date));
          const liveDates = new Set(o.entries.map((e) => e.date));
          const added = o.entries.filter((e) => !bundledDates.has(e.date));
          const removed = (data.years[String(y)] ?? []).filter((e) => !liveDates.has(e.date));
          if (added.length > 0 || removed.length > 0) {
            diffNotes.push(holidayDiffNote(y, added, removed));
          }
        }
        yearsRec[y] = { source: "live", entries: o.entries };
        liveAt.push(o.at);
      } else {
        failed.push(y);
        if (o && !o.ok && o.kind === "NOT_APPROVED") notApproved = true;
      }
    }
    const allLive = requested.every((y) => yearsRec[y]?.source === "live");
    const notes = [
      ...(failed.length > 0 ? [liveUnavailableNote(failed, notApproved)] : []),
      ...diffNotes,
      ...(allLive ? [] : base.notes),
    ];
    ctx.log.debug("holiday resolve", { requested: queryable.length, live: liveAt.length, fallback: failed.length });
    return {
      ...createCalendar(yearsRec, notes),
      requestedYears: requested,
      ...(liveAt.length > 0 ? { checkedAt: formatKstMinute(new Date(Math.min(...liveAt))) } : {}),
    };
  } catch {
    return { ...base, notes: [liveUnavailableNote(queryable, false), ...base.notes], requestedYears: requested };
  }
}
