import { describe, expect, it } from "vitest";
import { cached, TtlCache } from "../src/core/cache.js";
import { createDefaultContext } from "../src/core/context.js";
import { loadConfig } from "../src/core/config.js";
import { createTestContext } from "./helpers/context.js";

describe("TtlCache", () => {
  it("expires entries at ttl boundary and deletes them", () => {
    const c = new TtlCache();
    c.set("a", 1, 1000, 0);
    expect(c.get("a", 999)).toBe(1);
    expect(c.get("a", 1000)).toBeUndefined();
    expect(c.size).toBe(0);
  });

  it("ignores non-positive ttl", () => {
    const c = new TtlCache();
    c.set("z", 1, 0, 0);
    expect(c.size).toBe(0);
  });

  it("evicts least recently used entries beyond max", () => {
    const c = new TtlCache();
    for (let i = 0; i < 500; i++) c.set(`k${i}`, 1, 60000, 0);
    expect(c.get("k0", 1)).toBe(1);
    c.set("k500", 1, 60000, 0);
    expect(c.size).toBe(500);
    expect(c.get("k1", 2)).toBeUndefined();
    expect(c.get("k0", 2)).toBe(1);
    expect(c.get("k500", 2)).toBeDefined();
  });
});

describe("TtlCache clear", () => {
  it("TtlCache.clear empties entries and inflight", () => {
    const c = new TtlCache();
    c.set("a", 1, 60_000, 0);
    c.set("b", 2, 60_000, 0);
    c.set("c", 3, 60_000, 0);
    c.inflight.set("a", Promise.resolve(1));
    c.clear();
    expect(c.size).toBe(0);
    expect(c.keys()).toEqual([]);
    expect(c.inflight.size).toBe(0);
  });
});

describe("cached", () => {
  function clockCtx() {
    const base = createTestContext();
    let now = Date.parse("2026-10-28T00:00:00+09:00");
    return {
      ctx: { ...base, clock: { now: () => new Date(now) } },
      advance(ms: number) {
        now += ms;
      },
    };
  }

  it("returns cached value within ttl and refetches after expiry", async () => {
    const { ctx, advance } = clockCtx();
    let calls = 0;
    const fn = async () => {
      calls++;
      return "v";
    };
    const first = await cached(ctx, "k", 1000, fn);
    expect(first).toEqual({ value: "v", fromCache: false });
    const second = await cached(ctx, "k", 1000, fn);
    expect(second.fromCache).toBe(true);
    expect(calls).toBe(1);
    advance(1000);
    await cached(ctx, "k", 1000, fn);
    expect(calls).toBe(2);
  });

  it("does not store when ttl is zero", async () => {
    const { ctx } = clockCtx();
    let calls = 0;
    const fn = async () => {
      calls++;
      return 1;
    };
    await cached(ctx, "k", 0, fn);
    await cached(ctx, "k", 0, fn);
    expect(calls).toBe(2);
    expect(ctx.cache.size).toBe(0);
  });

  it("does not cache rejections", async () => {
    const { ctx } = clockCtx();
    let calls = 0;
    const fn = async () => {
      calls++;
      if (calls === 1) throw new Error("boom");
      return "ok";
    };
    await expect(cached(ctx, "k", 1000, fn)).rejects.toThrow("boom");
    const second = await cached(ctx, "k", 1000, fn);
    expect(second.value).toBe("ok");
    expect(calls).toBe(2);
  });

  it("shares in-flight requests for the same key", async () => {
    const { ctx } = clockCtx();
    let calls = 0;
    const fn = () =>
      new Promise<string>((resolve) => {
        calls++;
        setTimeout(() => resolve(`v${calls}`), 5);
      });
    const [a, b] = await Promise.all([cached(ctx, "k", 1000, fn), cached(ctx, "k", 1000, fn)]);
    expect(calls).toBe(1);
    expect(a.value).toBe(b.value);
  });
});

describe("cache isolation", () => {
  it("gives each test context its own cache", () => {
    expect(createTestContext().cache).not.toBe(createTestContext().cache);
  });

  it("default context carries a TtlCache", () => {
    expect(createDefaultContext(loadConfig({})).cache).toBeInstanceOf(TtlCache);
  });
});
