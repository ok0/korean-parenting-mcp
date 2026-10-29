import { describe, expect, it } from "vitest";
import { ToolError, dataGoKrError } from "../src/core/errors.js";
import {
  DEFAULT_BUDGETS,
  DEFAULT_MIN_TTL_FALLBACK_MS,
  DEFAULT_MIN_TTL_MS,
  DEFAULT_STALE_MAX_MS,
  DEFAULT_ALERT_RATIO,
  createUpstreamGuard,
  defaultQuotaConfig,
  remoteQuotaError,
  staleNotice,
  type QuotaEvent,
} from "../src/core/upstream-guard.js";

const DUR_URL = new URL("https://apis.data.go.kr/1471000/DURPrdlstInfoService03/getPwnmTabooInfoList03");
const NEMC_LIST_URL = new URL("https://apis.data.go.kr/B552657/HsptlAsembySearchService/getHsptlMdcncListInfoInqire");
const NEMC_MOON_URL = new URL("https://apis.data.go.kr/B552657/HsptlAsembySearchService/getBabyListInfoInqire");
const SK_URL = new URL("https://www.safetykorea.kr/openapi/api/recall/recallList.json");

function setup(overrides: Partial<ReturnType<typeof defaultQuotaConfig>> = {}) {
  let nowMs = Date.parse("2026-10-28T21:30:00+09:00");
  const events: QuotaEvent[] = [];
  const guard = createUpstreamGuard({ ...defaultQuotaConfig(), onEvent: (e) => events.push(e), ...overrides });
  return {
    guard,
    events,
    setNow(iso: string) {
      nowMs = Date.parse(iso);
    },
    now: () => nowMs,
  };
}

async function rejectionOf(p: Promise<unknown>): Promise<ToolError> {
  try {
    await p;
  } catch (err) {
    if (err instanceof ToolError) return err;
    throw err;
  }
  throw new Error("expected rejection");
}

describe("upstream guard defaults", () => {
  it("defaults match spec table", () => {
    expect(DEFAULT_BUDGETS).toEqual({
      nemcList: 450,
      nemcMoonlight: 450,
      benefits: 9000,
      dur: 9000,
      kasi: 9000,
      law: 3000,
      kindergarten: 3000,
      safetykorea: 0,
    });
    expect(DEFAULT_MIN_TTL_MS.nemcList).toBe(1_800_000);
    expect(DEFAULT_MIN_TTL_MS.nemcMoonlight).toBe(1_800_000);
    for (const b of ["benefits", "dur", "kasi", "law", "kindergarten", "safetykorea"] as const) {
      expect(DEFAULT_MIN_TTL_MS[b]).toBe(3_600_000);
    }
    expect(DEFAULT_STALE_MAX_MS).toBe(86_400_000);
    expect(DEFAULT_ALERT_RATIO).toBe(0.8);
    expect(DEFAULT_MIN_TTL_FALLBACK_MS).toBe(3_600_000);
  });

  it("defaultQuotaConfig returns fresh copies without webhook", () => {
    const a = defaultQuotaConfig();
    const b = defaultQuotaConfig();
    a.budgets.dur = 1;
    expect(b.budgets.dur).toBe(9000);
    expect(a.alertWebhookUrl).toBeUndefined();
  });
});

describe("budget and events", () => {
  it("budget 10: near on 8th, none on 9-10, 11th rejected with exhausted once", async () => {
    const t = setup({ budgets: { ...DEFAULT_BUDGETS, dur: 10 } });
    for (let i = 1; i <= 7; i++) await t.guard.admit(DUR_URL, t.now());
    expect(t.events).toHaveLength(0);
    await t.guard.admit(DUR_URL, t.now());
    expect(t.events).toEqual([{ bucket: "dur", level: "near", count: 8, limit: 10, day: "2026-10-28" }]);
    await t.guard.admit(DUR_URL, t.now());
    await t.guard.admit(DUR_URL, t.now());
    expect(t.events).toHaveLength(1);

    const err = await rejectionOf(t.guard.admit(DUR_URL, t.now()));
    expect(err.kind).toBe("DAILY_LIMIT");
    expect(err.detail).toEqual({ source: "guard", bucket: "dur" });
    expect(err.actions[0]).toContain("잠시 후 재시도");
    expect(t.events).toHaveLength(2);
    expect(t.events[1]).toEqual({ bucket: "dur", level: "exhausted", count: 10, limit: 10, day: "2026-10-28" });

    await rejectionOf(t.guard.admit(DUR_URL, t.now()));
    expect(t.events).toHaveLength(2);
    expect((await t.guard.counts(t.now())).dur).toBe(10);
  });

  it("event keys only", async () => {
    const t = setup({ budgets: { ...DEFAULT_BUDGETS, dur: 1 } });
    await t.guard.admit(DUR_URL, t.now());
    await rejectionOf(t.guard.admit(DUR_URL, t.now()));
    expect(t.events.length).toBeGreaterThan(0);
    for (const e of t.events) {
      expect(Object.keys(e).sort()).toEqual(["bucket", "count", "day", "level", "limit"]);
    }
  });

  it("budget 0 always rejects", async () => {
    const t = setup();
    await rejectionOf(t.guard.admit(SK_URL, t.now()));
  });

  it("unclassified url not counted", async () => {
    const t = setup();
    for (let i = 0; i < 100; i++) await t.guard.admit(new URL("https://example.com/x"), t.now());
    const counts = await t.guard.counts(t.now());
    for (const v of Object.values(counts)) expect(v).toBe(0);
  });
});

describe("markExhausted and day boundaries", () => {
  it("markExhausted blocks only that bucket until next KST day", async () => {
    const t = setup();
    await t.guard.markExhausted("nemcList", t.now());
    expect(t.events).toEqual([{ bucket: "nemcList", level: "exhausted", count: 0, limit: 450, day: "2026-10-28" }]);

    await rejectionOf(t.guard.admit(NEMC_LIST_URL, t.now()));
    await t.guard.admit(NEMC_MOON_URL, t.now());
    await t.guard.admit(DUR_URL, t.now());

    t.setNow("2026-10-29T00:00:01+09:00");
    await t.guard.admit(NEMC_LIST_URL, t.now());
    const counts = await t.guard.counts(t.now());
    expect(counts.nemcList).toBe(1);
    expect(counts.nemcMoonlight).toBe(0);
    expect(counts.dur).toBe(0);

    await t.guard.markExhausted("nemcList", t.now());
    expect(t.events.at(-1)).toEqual({ bucket: "nemcList", level: "exhausted", count: 1, limit: 450, day: "2026-10-29" });
  });

  it("day boundary resets counts and near", async () => {
    const t = setup({ budgets: { ...DEFAULT_BUDGETS, dur: 10 } });
    for (let i = 0; i < 8; i++) await t.guard.admit(DUR_URL, t.now());
    t.setNow("2026-10-29T09:00:00+09:00");
    for (let i = 0; i < 8; i++) await t.guard.admit(DUR_URL, t.now());
    const nears = t.events.filter((e) => e.level === "near");
    expect(nears).toEqual([
      { bucket: "dur", level: "near", count: 8, limit: 10, day: "2026-10-28" },
      { bucket: "dur", level: "near", count: 8, limit: 10, day: "2026-10-29" },
    ]);
  });

  it("KST boundary", async () => {
    const t = setup({ budgets: { ...DEFAULT_BUDGETS, dur: 10 } });
    t.setNow("2026-10-28T23:59:59+09:00");
    await t.guard.admit(DUR_URL, t.now());
    expect((await t.guard.counts(t.now())).dur).toBe(1);
    t.setNow("2026-10-29T00:00:00+09:00");
    expect((await t.guard.counts(t.now())).dur).toBe(0);
  });
});

describe("minTtl and remote errors", () => {
  it("minTtl", () => {
    const g = createUpstreamGuard(defaultQuotaConfig());
    expect(g.minTtl("dgk:nemcList?x=1")).toBe(1_800_000);
    expect(g.minTtl("dgk:vaccClinic?")).toBe(DEFAULT_MIN_TTL_FALLBACK_MS);
  });

  it("remoteQuotaError rewrites quota kinds only", () => {
    const daily = remoteQuotaError(dataGoKrError("22"));
    expect(daily.kind).toBe("DAILY_LIMIT");
    expect(daily.detail).toEqual({ code: "22" });
    expect(daily.actions[0]).toContain("잠시 후 재시도");
    expect(daily.actions[0]).toContain("내일 이후");

    const rate = remoteQuotaError(dataGoKrError("23"));
    expect(rate.kind).toBe("RATE_LIMIT");
    expect(rate.actions[0]).toContain("잠시 후 재시도");

    const upstream = dataGoKrError("99");
    expect(remoteQuotaError(upstream)).toBe(upstream);
  });

  it("staleNotice formats minutes", () => {
    expect(staleNotice(31 * 60_000)).toContain("약 31분 전에 저장된 정보");
    expect(staleNotice(0)).toContain("약 1분");
  });
});
