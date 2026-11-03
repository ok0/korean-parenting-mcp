import { callDataGoKr, dataGoKrCacheKey, type DataGoKrParams, type DataGoKrResult } from "../clients/data-go-kr.js";
import { SPECS } from "../clients/data-go-kr-specs.js";
import { isRecord } from "../clients/parse.js";
import { settleWithin } from "../core/deadline.js";
import type { ToolContext } from "../core/context.js";
import { ToolError } from "../core/errors.js";
import type { WelfareRegionParams } from "../region/welfare-names.js";
import {
  compareLcgv,
  LCGV_APPLY_ACTION,
  sidoCommonMayBeMissing,
  toLcgvDetail,
  toLcgvRow,
  type LcgvDetail,
  type LcgvRow,
} from "./summarize.js";

export const LCGV_BUDGET = 4;
export const LCGV_DETAIL_MAX = 3;
export const LCGV_LIST_ROWS = 100;
export const LCGV_STALE_MAX_MS = 7 * 24 * 60 * 60 * 1000;
export const LIFE_CODES = { pregnancy: "007", infant: "001" } as const;
export const LIFE_CODE_VERIFIED = false;
export const LCGV_MULTI_LIFE: string | null = "007,001";
export const LIFE_LABELS = { pregnancy: "임신·출산", infant: "영유아" } as const;
export const LCGV_LAST_PREFIX = "lcgv:last:";
export const LCGV_ACTIONS = {
  DAILY_LIMIT: "하루 호출 한도(개발계정 1,000회)에 도달했어요. 내일 다시 시도해 주세요.",
  RATE_LIMIT: "몇 초 뒤 다시 시도해 주세요.",
  SLOW: "지자체복지서비스 응답이 늦어요. 잠시 후 다시 시도해 주세요.",
} as const;

export type LcgvStage = "pregnancy" | "infant" | "all";

export type LifeOptions = { verified: boolean; multi: string | null };

export type LifeFilter = { lifeArray?: string; stageFilter: "server" | "client"; labels: readonly string[] };

export type LocalSupportQuery = {
  region: WelfareRegionParams;
  stage: LcgvStage;
  keyword?: string;
  limit?: number;
};

export type LocalSupportResult = {
  rows: LcgvRow[];
  total: number;
  received: number;
  details: ReadonlyMap<string, LcgvDetail>;
  detailFailed: number;
  calls: number;
  stale?: { ageMs: number };
  stageFilter: "server" | "client";
  sidoCommonMayBeMissing: boolean;
};

type SavedList = { items: Record<string, unknown>[]; totalCount?: number; savedAtMs: number };

export function lifeFilter(
  stage: LcgvStage,
  opts: LifeOptions = { verified: LIFE_CODE_VERIFIED, multi: LCGV_MULTI_LIFE },
): LifeFilter {
  if (stage === "pregnancy") {
    return { lifeArray: LIFE_CODES.pregnancy, stageFilter: "server", labels: [LIFE_LABELS.pregnancy] };
  }
  if (stage === "infant") {
    return opts.verified
      ? { lifeArray: LIFE_CODES.infant, stageFilter: "server", labels: [LIFE_LABELS.infant] }
      : { stageFilter: "client", labels: [LIFE_LABELS.infant] };
  }
  const both = [LIFE_LABELS.pregnancy, LIFE_LABELS.infant];
  return opts.multi !== null
    ? { lifeArray: opts.multi, stageFilter: "server", labels: both }
    : { stageFilter: "client", labels: both };
}

export function matchesLife(row: LcgvRow, labels: readonly string[]): boolean {
  const haystacks = [row.lifeNames ?? "", row.themes ?? ""].map((s) => s.replace(/\s+/g, ""));
  return labels.some((label) => {
    const needle = label.replace(/\s+/g, "");
    return haystacks.some((h) => h.includes(needle));
  });
}

export function listParams(q: LocalSupportQuery, lf: LifeFilter): DataGoKrParams {
  return {
    ctpvNm: q.region.ctpvNm,
    sggNm: q.region.sggNm,
    searchWrd: q.keyword?.trim() || undefined,
    numOfRows: LCGV_LIST_ROWS,
    pageNo: 1,
    lifeArray: lf.lifeArray,
  };
}

function retryable(e: unknown): boolean {
  return e instanceof ToolError && (e.kind === "TIMEOUT" || (e.kind === "UPSTREAM" && e.detail?.code === "99"));
}

export async function fetchLocalSupport(
  q: LocalSupportQuery,
  ctx: ToolContext,
  opts?: { life?: LifeOptions },
): Promise<LocalSupportResult> {
  const now = () => ctx.clock.now().getTime();
  const deadline = now() + ctx.config.chainDeadlineMs;
  const remaining = () => deadline - now();

  let calls = 0;
  const base: ToolContext = {
    ...ctx,
    fetch: ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      calls += 1;
      return ctx.fetch(input, init);
    }) as typeof fetch,
  };
  const callCtx = (): ToolContext => ({
    ...base,
    config: { ...ctx.config, httpTimeoutMs: Math.max(1, Math.min(ctx.config.httpTimeoutMs, remaining())) },
  });

  const lf = lifeFilter(q.stage, opts?.life);
  const params = listParams(q, lf);
  const lastKey = LCGV_LAST_PREFIX + dataGoKrCacheKey(SPECS.lcgvList, params);
  const scopeQ = { sggNm: q.region.sggNm };

  let list: DataGoKrResult | undefined;
  let lastErr: unknown;
  for (const attempt of [0, 1]) {
    if (attempt === 1 && !(calls < LCGV_BUDGET && remaining() > 0)) break;
    try {
      list = await callDataGoKr(SPECS.lcgvList, params, callCtx(), { retries: 0 });
      break;
    } catch (e) {
      lastErr = e;
      if (!retryable(e)) break;
    }
  }

  let src: { items: Record<string, unknown>[]; totalCount?: number } | undefined = list;
  let stale: { ageMs: number } | undefined;
  if (list === undefined) {
    const e = lastErr;
    if (!(e instanceof ToolError)) throw e;
    if (e.kind === "KEY_INVALID" || e.kind === "NOT_APPROVED" || e.kind === "KEY_EXPIRED") {
      throw new ToolError(e.kind, e.message, { detail: e.detail, actions: [...e.actions, LCGV_APPLY_ACTION] });
    }
    if (e.kind === "DAILY_LIMIT" || e.kind === "RATE_LIMIT" || e.kind === "TIMEOUT" || e.kind === "UPSTREAM") {
      const saved = await ctx.cache.get<SavedList>(lastKey, now());
      if (saved !== undefined) {
        src = saved;
        stale = { ageMs: now() - saved.savedAtMs };
      } else {
        const action =
          e.kind === "DAILY_LIMIT"
            ? LCGV_ACTIONS.DAILY_LIMIT
            : e.kind === "RATE_LIMIT"
              ? LCGV_ACTIONS.RATE_LIMIT
              : e.kind === "TIMEOUT" || e.detail?.code === "99"
                ? LCGV_ACTIONS.SLOW
                : undefined;
        if (action !== undefined) throw new ToolError(e.kind, e.message, { detail: e.detail, actions: [action] });
        throw e;
      }
    } else {
      throw e;
    }
  }

  if (list !== undefined && !list.fromCache) {
    await ctx.cache.set(
      lastKey,
      { items: list.items, totalCount: list.totalCount, savedAtMs: now() },
      LCGV_STALE_MAX_MS,
      now(),
    );
  }

  const current = src!;
  const rows = current.items
    .map(toLcgvRow)
    .filter((r): r is LcgvRow => r !== undefined);
  const filtered = lf.stageFilter === "client" ? rows.filter((r) => matchesLife(r, lf.labels)) : rows;
  const sorted = [...filtered].sort(compareLcgv(scopeQ));

  const details = new Map<string, LcgvDetail>();
  let detailFailed = 0;
  if (stale === undefined) {
    const n =
      remaining() > 0
        ? Math.max(0, Math.min(LCGV_DETAIL_MAX, LCGV_BUDGET - calls, q.limit ?? LCGV_DETAIL_MAX, sorted.length))
        : 0;
    const targets = sorted.slice(0, n);
    const settled = await settleWithin(
      targets.map((r) => callDataGoKr(SPECS.lcgvDetail, { servId: r.servId }, callCtx(), { retries: 0 })),
      remaining(),
    );
    for (let i = 0; i < settled.length; i++) {
      const s = settled[i]!;
      const item = s.ok ? s.value.items[0] : undefined;
      if (s.ok && isRecord(item)) {
        details.set(targets[i]!.servId, toLcgvDetail(item));
      } else {
        detailFailed += 1;
      }
    }
  }

  return {
    rows: sorted,
    total: current.totalCount ?? current.items.length,
    received: current.items.length,
    details,
    detailFailed,
    calls,
    ...(stale ? { stale } : {}),
    stageFilter: lf.stageFilter,
    sidoCommonMayBeMissing: sidoCommonMayBeMissing(sorted, scopeQ),
  };
}
