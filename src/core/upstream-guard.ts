import { ToolError } from "./errors.js";

export const UPSTREAM_BUCKETS = ["nemcList", "nemcMoonlight", "benefits", "dur", "kasi", "law", "kindergarten", "safetykorea"] as const;
export type UpstreamBucket = (typeof UPSTREAM_BUCKETS)[number];

export interface QuotaEvent {
  bucket: UpstreamBucket;
  day: string;
  count: number;
  limit: number;
  level: "near" | "exhausted";
}

export interface QuotaConfig {
  budgets: Record<UpstreamBucket, number>;
  minTtlMs: Record<UpstreamBucket, number>;
  defaultMinTtlMs: number;
  staleMaxMs: number;
  alertRatio: number;
  alertWebhookUrl?: string;
}

export const DEFAULT_BUDGETS: Readonly<Record<UpstreamBucket, number>> = {
  nemcList: 450,
  nemcMoonlight: 450,
  benefits: 9000,
  dur: 9000,
  kasi: 9000,
  law: 0, // remote has no fixed egress IP: law.go.kr never admitted (M28, ADR-37)
  kindergarten: 3000,
  safetykorea: 0,
};
export const DEFAULT_MIN_TTL_FALLBACK_MS = 3_600_000;
export const DEFAULT_MIN_TTL_MS: Readonly<Record<UpstreamBucket, number>> = {
  nemcList: 1_800_000,
  nemcMoonlight: 1_800_000,
  benefits: 3_600_000,
  dur: 3_600_000,
  kasi: 3_600_000,
  law: 3_600_000,
  kindergarten: 3_600_000,
  safetykorea: 3_600_000,
};
export const DEFAULT_STALE_MAX_MS = 86_400_000;
export const DEFAULT_ALERT_RATIO = 0.8;

export function defaultQuotaConfig(): QuotaConfig {
  return {
    budgets: { ...DEFAULT_BUDGETS },
    minTtlMs: { ...DEFAULT_MIN_TTL_MS },
    defaultMinTtlMs: DEFAULT_MIN_TTL_FALLBACK_MS,
    staleMaxMs: DEFAULT_STALE_MAX_MS,
    alertRatio: DEFAULT_ALERT_RATIO,
  };
}

export const QUOTA_ACTIONS = {
  DAILY_LIMIT: ["잠시 후 재시도하세요. 오늘 조회 한도에 도달했다면 내일 이후 재시도하세요."],
  RATE_LIMIT: ["잠시 후 재시도하세요."],
} as const;

export function staleNotice(ageMs: number): string {
  return `일부 결과는 조회 한도·장애로 약 ${Math.max(1, Math.round(ageMs / 60_000))}분 전에 저장된 정보입니다(최신이 아닐 수 있음).`;
}

export function remoteQuotaError(err: ToolError): ToolError {
  if (err.kind === "DAILY_LIMIT" || err.kind === "RATE_LIMIT") {
    const kind = err.kind;
    return new ToolError(kind, err.message, {
      actions: [...QUOTA_ACTIONS[kind]],
      ...(err.detail ? { detail: err.detail } : {}),
    });
  }
  return err;
}

export function bucketOfUrl(url: URL): UpstreamBucket | undefined {
  const host = url.hostname.toLowerCase();
  const p = url.pathname;
  if (host === "apis.data.go.kr") {
    if (p.startsWith("/B552657/")) return p.endsWith("/getBabyListInfoInqire") ? "nemcMoonlight" : "nemcList";
    if (p.startsWith("/1471000/DURPrdlstInfoService03/")) return "dur";
    if (p.startsWith("/B090041/")) return "kasi";
    return undefined;
  }
  if (host === "api.odcloud.kr") return "benefits";
  if (host === "www.law.go.kr") return "law";
  if (host === "e-childschoolinfo.moe.go.kr") return "kindergarten";
  if (host === "www.safetykorea.kr") return "safetykorea";
  return undefined;
}

const CACHE_KEY_BUCKETS: ReadonlyArray<readonly [string, UpstreamBucket]> = [
  ["dgk:nemcList?", "nemcList"],
  ["dgk:nemcMoonlight?", "nemcMoonlight"],
  ["dgk:benefitsList?", "benefits"],
  ["dgk:durPregnancy?", "dur"],
  ["dgk:kasiHoliday?", "kasi"],
  ["kasi-live:", "kasi"],
  ["law:", "law"],
  ["kg:", "kindergarten"],
  ["sk:", "safetykorea"],
];

export function bucketOfCacheKey(key: string): UpstreamBucket | undefined {
  for (const [prefix, bucket] of CACHE_KEY_BUCKETS) {
    if (key.startsWith(prefix)) return bucket;
  }
  return undefined;
}

export interface UpstreamGuard {
  admit(url: URL, nowMs: number): Promise<void>;
  minTtl(key: string): number;
  readonly staleMaxMs: number;
  markExhausted(bucket: UpstreamBucket, nowMs: number): Promise<void>;
  counts(nowMs: number): Promise<Record<UpstreamBucket, number>>;
}

interface GuardState {
  day: string;
  counts: Record<UpstreamBucket, number>;
  blocked: Set<UpstreamBucket>;
  emitted: Set<string>;
}

function zeroRecord(): Record<UpstreamBucket, number> {
  return Object.fromEntries(UPSTREAM_BUCKETS.map((b) => [b, 0])) as Record<UpstreamBucket, number>;
}

function freshState(day: string): GuardState {
  return { day, counts: zeroRecord(), blocked: new Set<UpstreamBucket>(), emitted: new Set<string>() };
}

function kstDay(nowMs: number): string {
  return new Date(nowMs + 9 * 3_600_000).toISOString().slice(0, 10);
}

export function createUpstreamGuard(opts: QuotaConfig & { onEvent?: (e: QuotaEvent) => void }): UpstreamGuard {
  let st: GuardState = freshState("");

  const roll = (nowMs: number): void => {
    const day = kstDay(nowMs);
    if (day !== st.day) st = freshState(day);
  };

  const emitOnce = (b: UpstreamBucket, level: "near" | "exhausted"): void => {
    const k = `${b}:${level}`;
    if (st.emitted.has(k)) return;
    st.emitted.add(k);
    try {
      opts.onEvent?.({ bucket: b, day: st.day, count: st.counts[b], limit: opts.budgets[b], level });
    } catch {
      // event sink failures never affect admission
    }
  };

  return {
    async admit(url, nowMs) {
      const b = bucketOfUrl(url);
      if (b === undefined) return;
      roll(nowMs);
      if (st.blocked.has(b) || st.counts[b] >= opts.budgets[b]) {
        emitOnce(b, "exhausted");
        throw new ToolError("DAILY_LIMIT", "조회 한도 보호로 지금은 이 정보를 조회할 수 없습니다", {
          actions: [...QUOTA_ACTIONS.DAILY_LIMIT],
          detail: { source: "guard", bucket: b },
        });
      }
      st.counts[b] += 1;
      if (opts.budgets[b] > 0 && st.counts[b] >= Math.max(1, Math.ceil(opts.budgets[b] * opts.alertRatio - 1e-9))) {
        emitOnce(b, "near");
      }
    },
    minTtl(key) {
      const b = bucketOfCacheKey(key);
      return b ? opts.minTtlMs[b] : opts.defaultMinTtlMs;
    },
    staleMaxMs: opts.staleMaxMs,
    async markExhausted(bucket, nowMs) {
      roll(nowMs);
      st.blocked.add(bucket);
      emitOnce(bucket, "exhausted");
    },
    async counts(nowMs) {
      roll(nowMs);
      return { ...st.counts };
    },
  };
}
