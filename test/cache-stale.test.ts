import { describe, expect, it, vi } from "vitest";
import { cached, TtlCache } from "../src/core/cache.js";
import { ToolError, dataGoKrError } from "../src/core/errors.js";
import { createUpstreamGuard, defaultQuotaConfig, staleNotice, type UpstreamGuard } from "../src/core/upstream-guard.js";

const T0 = Date.parse("2026-10-28T21:30:00+09:00");
const MIN = 60_000;

function setup(overrides: Partial<ReturnType<typeof defaultQuotaConfig>> = {}) {
  let nowMs = T0;
  const clock = { now: () => new Date(nowMs) };
  const cache = new TtlCache(500, 86_400_000);
  const guard = createUpstreamGuard({ ...defaultQuotaConfig(), ...overrides });
  const ctx = { cache, clock, upstream: guard, notices: [] as string[] };
  return {
    ctx,
    cache,
    guard,
    setNow(ms: number) {
      nowMs = ms;
    },
  };
}

describe("TtlCache retention and peekStale", () => {
  it("TtlCache default drops expired, LRU 500 unchanged", () => {
    const c = new TtlCache();
    c.set("k", "v", 1000, T0);
    expect(c.get("k", T0 + 1000)).toBeUndefined();
    expect(c.size).toBe(0);
    expect(c.peekStale("k", T0 + 1000, 1e9)).toBeUndefined();
    expect(c.staleRetentionMs).toBe(0);

    const lru = new TtlCache();
    for (let i = 0; i <= 500; i += 1) lru.set(`k${i}`, i, 1e9, T0);
    expect(lru.size).toBe(500);
    expect(lru.get("k0", T0)).toBeUndefined();
  });

  it("retention keeps expired only for peekStale", () => {
    const c = new TtlCache(500, 10_000);
    c.set("k", "v", 1000, T0);
    expect(c.get("k", T0 + 1500)).toBeUndefined();
    expect(c.size).toBe(1);
    expect(c.peekStale("k", T0 + 1500, 60_000)).toEqual({ value: "v", ageMs: 1500 });
    expect(c.peekStale("k", T0 + 1500, 1000)).toBeUndefined();
    expect(c.peekStale("k", T0 + 11_000, 60_000)).toBeUndefined();
    expect(c.size).toBe(0);
  });
});

describe("guarded cached", () => {
  it("guarded cached applies min TTL to ttl 0", async () => {
    const { ctx, setNow } = setup();
    const fn = vi.fn(async () => "v");
    const key = "dgk:nemcList?q=1";
    const first = await cached(ctx, key, 0, fn);
    const second = await cached(ctx, key, 0, fn);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(second.fromCache).toBe(true);
    expect(first.value).toBe("v");

    setNow(T0 + 30 * MIN + 1);
    await cached(ctx, key, 0, fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("without upstream the same calls run fn twice (local TTL 0)", async () => {
    const clock = { now: () => new Date(T0) };
    const ctx = { cache: new TtlCache(), clock };
    const fn = vi.fn(async () => "v");
    await cached(ctx, "dgk:nemcList?q=1", 0, fn);
    await cached(ctx, "dgk:nemcList?q=1", 0, fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("guarded inflight shares and failures not stored", async () => {
    const { ctx, cache } = setup();
    const fn = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return "v";
    });
    const [a, b] = await Promise.all([cached(ctx, "dgk:nemcList?q=2", 0, fn), cached(ctx, "dgk:nemcList?q=2", 0, fn)]);
    expect(fn).toHaveBeenCalledTimes(1);
    expect([a.value, b.value]).toEqual(["v", "v"]);

    const failCtx = { ...setup().ctx, cache: new TtlCache(500, 86_400_000) };
    const failing = vi.fn(async () => {
      throw new ToolError("BAD_INPUT", "boom");
    });
    const key = "dgk:nemcList?q=3";
    await expect(cached(failCtx, key, 0, failing)).rejects.toMatchObject({ kind: "BAD_INPUT", message: "boom" });
    expect(failCtx.cache.size).toBe(0);
    await expect(cached(failCtx, key, 0, failing)).rejects.toMatchObject({ kind: "BAD_INPUT" });
    expect(failing).toHaveBeenCalledTimes(2);
    expect(cache.size).toBe(1);
  });

  it("stale-if-error returns old value with notice and marks the bucket exhausted", async () => {
    const { ctx, guard, setNow } = setup();
    const key = "dgk:nemcList?q=1";
    await cached(ctx, key, 0, async () => "old");
    setNow(T0 + 31 * MIN);
    const out = await cached(ctx, key, 0, async () => {
      throw dataGoKrError("22");
    });
    expect(out).toEqual({ value: "old", fromCache: true, stale: { ageMs: 31 * MIN } });
    expect(ctx.notices).toEqual([staleNotice(31 * MIN)]);
    expect(await guard.counts(T0 + 31 * MIN)).toEqual(expect.objectContaining({ nemcList: 0 }));
    const url = new URL("https://apis.data.go.kr/B552657/HsptlAsembySearchService/getHsptlMdcncListInfoInqire");
    const err = await guard.admit(url, T0 + 31 * MIN).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ToolError);
    expect((err as ToolError).detail).toMatchObject({ source: "guard" });
  });

  it("guard DAILY_LIMIT does not re-block", async () => {
    const markExhausted = vi.fn(async () => {});
    const spy = {
      admit: async () => {},
      minTtl: () => 1000,
      staleMaxMs: 1e9,
      markExhausted,
      counts: async () => ({}),
    } as unknown as UpstreamGuard;
    const clock = { now: () => new Date(T0) };
    const ctx = { cache: new TtlCache(), clock, upstream: spy };
    const err = await cached(ctx, "dgk:durPregnancy?x=1", 0, async () => {
      throw new ToolError("DAILY_LIMIT", "x", { detail: { source: "guard", bucket: "dur" } });
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ToolError);
    expect(markExhausted).not.toHaveBeenCalled();
  });

  it("no stale on empty cache gives retry wording for quota errors", async () => {
    const { ctx } = setup();
    const err = await cached(ctx, "dgk:nemcList?q=9", 0, async () => {
      throw dataGoKrError("22");
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ToolError);
    expect((err as ToolError).kind).toBe("DAILY_LIMIT");
    expect((err as ToolError).actions[0]).toContain("잠시 후 재시도");

    const rate = await cached(ctx, "dgk:nemcList?q=10", 0, async () => {
      throw dataGoKrError("23");
    }).catch((e: unknown) => e);
    expect((rate as ToolError).kind).toBe("RATE_LIMIT");
    expect((rate as ToolError).actions[0]).toContain("잠시 후 재시도");

    const upstreamErr = new ToolError("UPSTREAM", "x");
    const same = await cached(ctx, "dgk:nemcList?q=11", 0, async () => {
      throw upstreamErr;
    }).catch((e: unknown) => e);
    expect(same).toBe(upstreamErr);
  });

  it("non-quota errors never use stale", async () => {
    const { ctx, setNow } = setup();
    const key = "dgk:nemcList?q=1";
    await cached(ctx, key, 0, async () => "old");
    setNow(T0 + 31 * MIN);
    await expect(
      cached(ctx, key, 0, async () => {
        throw dataGoKrError("30");
      }),
    ).rejects.toMatchObject({ kind: "KEY_INVALID" });
    await expect(
      cached(ctx, key, 0, async () => {
        throw new ToolError("BAD_INPUT", "x");
      }),
    ).rejects.toMatchObject({ kind: "BAD_INPUT" });
  });

  it("stale older than staleMaxMs not used", async () => {
    const { ctx, setNow } = setup({ staleMaxMs: 60_000 });
    const key = "dgk:nemcList?q=1";
    await cached(ctx, key, 0, async () => "old");
    setNow(T0 + 31 * MIN);
    await expect(
      cached(ctx, key, 0, async () => {
        throw dataGoKrError("22");
      }),
    ).rejects.toMatchObject({ kind: "DAILY_LIMIT" });
  });

  it("nested stale propagates and outer does not store", async () => {
    const { ctx, setNow } = setup({ staleMaxMs: 172_800_000 });
    let innerFail = false;
    let outerCalls = 0;
    const innerFn = async () => {
      if (innerFail) throw new ToolError("UPSTREAM", "down");
      return "kasi";
    };
    const outerFn = async () => {
      outerCalls += 1;
      return (await cached(ctx, "dgk:kasiHoliday?solYear=2026", 86_400_000, innerFn)).value;
    };
    await cached(ctx, "kasi-live:2026", 86_400_000, outerFn);
    expect(outerCalls).toBe(1);

    innerFail = true;
    const now = T0 + 24 * 60 * MIN + MIN;
    setNow(now);
    const first = await cached(ctx, "kasi-live:2026", 86_400_000, outerFn);
    expect(first.stale).toBeDefined();
    expect(first.value).toBe("kasi");
    expect(ctx.notices.length).toBe(1);

    const second = await cached(ctx, "kasi-live:2026", 86_400_000, outerFn);
    expect(outerCalls).toBe(3);
    expect(second.stale).toBeDefined();
  });

  it("inflight sharer gets stale flag with its own notices", async () => {
    const { ctx, cache, guard, setNow } = setup();
    const key = "dgk:nemcList?q=1";
    await cached(ctx, key, 0, async () => "old");
    setNow(T0 + 31 * MIN);
    const ctxA = { cache, clock: ctx.clock, upstream: guard, notices: [] as string[] };
    const ctxB = { cache, clock: ctx.clock, upstream: guard, notices: [] as string[] };
    const fail = async () => {
      throw dataGoKrError("22");
    };
    const [a, b] = await Promise.all([cached(ctxA, key, 0, fail), cached(ctxB, key, 0, fail)]);
    expect(a.stale).toBeDefined();
    expect(b.stale).toBeDefined();
    expect(ctxA.notices).toContain(staleNotice(31 * MIN));
    expect(ctxB.notices).toContain(staleNotice(31 * MIN));
  });
});
