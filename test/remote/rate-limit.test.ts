import { describe, expect, it, vi } from "vitest";
import {
  createClientKeyResolver,
  createRateLimiter,
  type RateLimitOptions,
  type TakeResult,
} from "../../src/remote/rate-limit.js";

const base: RateLimitOptions = {
  perClientPerMin: 2,
  sharedPoolPerMin: 3,
  globalPerMin: 100,
  maxConcurrent: 100,
  sharedEgressCidrs: ["160.79.104.0/21"],
};
const t = 1_000_000;

function okOf(r: TakeResult): Extract<TakeResult, { ok: true }> {
  if (!r.ok) throw new Error("expected ok");
  return r;
}

describe("rate limit", () => {
  it("per-client window", async () => {
    const lim = createRateLimiter(base);
    expect((await lim.take("a", t)).ok).toBe(true);
    expect((await lim.take("a", t)).ok).toBe(true);
    expect(await lim.take("a", t)).toMatchObject({ ok: false, scope: "client", retryAfterSec: 60 });
    expect((await lim.take("b", t)).ok).toBe(true);
    expect((await lim.take("a", t + 60_000)).ok).toBe(true);
  });

  it("shared pool sums egress IPs and does not affect direct", async () => {
    const lim = createRateLimiter(base);
    for (const ip of ["160.79.104.10", "160.79.105.20", "160.79.111.200"]) {
      expect(await lim.take(ip, t)).toMatchObject({ ok: true, pool: "shared" });
    }
    expect(await lim.take("160.79.106.1", t)).toMatchObject({ ok: false, scope: "shared" });
    expect(await lim.take("198.51.100.7", t)).toMatchObject({ ok: true, pool: "direct" });
    expect(await lim.take("::ffff:160.79.104.9", t)).toMatchObject({ ok: false, pool: "shared" });

    const lim2 = createRateLimiter(base);
    expect((await lim2.take("198.51.100.7", t)).ok).toBe(true);
    expect((await lim2.take("198.51.100.7", t)).ok).toBe(true);
    expect((await lim2.take("198.51.100.7", t)).ok).toBe(false);
    expect(await lim2.take("160.79.104.10", t)).toMatchObject({ ok: true, pool: "shared" });
  });

  it("global limit", async () => {
    const lim = createRateLimiter({ ...base, globalPerMin: 3 });
    expect((await lim.take("10.0.0.1", t)).ok).toBe(true);
    expect((await lim.take("10.0.0.2", t)).ok).toBe(true);
    expect((await lim.take("10.0.0.3", t)).ok).toBe(true);
    expect(await lim.take("10.0.0.4", t)).toMatchObject({ ok: false, scope: "global" });
  });

  it("concurrency and release", async () => {
    const lim = createRateLimiter({ ...base, maxConcurrent: 1 });
    const r1 = okOf(await lim.take("198.51.100.1", t));
    expect(await lim.take("198.51.100.2", t)).toMatchObject({ ok: false, scope: "concurrency", retryAfterSec: 1 });
    r1.release();
    r1.release();
    const r2 = okOf(await lim.take("198.51.100.3", t));
    expect(await lim.take("198.51.100.4", t)).toMatchObject({ ok: false, scope: "concurrency" });
    expect(r2.ok).toBe(true);
  });

  it("expired entries are swept", async () => {
    const lim = createRateLimiter(base);
    for (const ip of ["10.0.0.1", "10.0.0.2", "10.0.0.3", "10.0.0.4", "10.0.0.5"]) {
      await lim.take(ip, t);
    }
    expect(lim.trackedClients).toBe(5);
    await lim.take("x", t + 60_000);
    expect(lim.trackedClients).toBe(1);
    await lim.take("y", t + 180_000);
    expect(lim.trackedClients).toBe(1);
  });

  it("max clients evicts oldest", async () => {
    const lim = createRateLimiter({ ...base, perClientPerMin: 1, globalPerMin: 1000, maxClients: 3 });
    for (const ip of ["10.0.0.1", "10.0.0.2", "10.0.0.3", "10.0.0.4", "10.0.0.5"]) {
      expect((await lim.take(ip, t)).ok).toBe(true);
    }
    expect(lim.trackedClients).toBe(3);
    expect((await lim.take("10.0.0.1", t)).ok).toBe(true);
    expect(await lim.take("10.0.0.5", t)).toMatchObject({ ok: false, scope: "client" });
  });

  it("exposes no key listing", async () => {
    expect(Object.keys(createRateLimiter(base)).sort()).toEqual(["clear", "take", "trackedClients"]);
    expect(Object.keys(await import("../../src/remote/rate-limit.js")).sort()).toEqual([
      "DEFAULT_MAX_CLIENTS",
      "WINDOW_MS",
      "createClientKeyResolver",
      "createRateLimiter",
      "normalizeIp",
    ]);
  });

  it("clear empties all windows", async () => {
    const lim = createRateLimiter({ ...base, perClientPerMin: 1 });
    for (const ip of ["10.0.0.1", "10.0.0.2", "10.0.0.3", "10.0.0.4", "10.0.0.5"]) {
      await lim.take(ip, t);
    }
    expect(await lim.take("160.79.104.10", t)).toMatchObject({ ok: true, pool: "shared" });
    expect(lim.trackedClients).toBe(5);
    lim.clear();
    expect(lim.trackedClients).toBe(0);
    expect(await lim.take("10.0.0.1", t)).toMatchObject({ ok: true });
  });

  it("take sweeps expired entries without timer (AC6)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(t);
    const lim = createRateLimiter({ ...base, sweepIntervalMs: 0 });
    for (const ip of ["10.0.0.1", "10.0.0.2", "10.0.0.3", "10.0.0.4", "10.0.0.5"]) {
      await lim.take(ip, t);
    }
    vi.advanceTimersByTime(120_000);
    expect(lim.trackedClients).toBe(5);
    await lim.take("9.9.9.9", t + 60_000);
    expect(lim.trackedClients).toBe(1);
    vi.useRealTimers();
  });

  it("daily cap per KST day", async () => {
    const lim = createRateLimiter({ ...base, perClientPerMin: 100, globalPerMin: 1000, dailyCap: 2 });
    const t0 = Date.parse("2026-10-28T14:59:00Z");
    expect((await lim.take("10.0.0.1", t0)).ok).toBe(true);
    expect((await lim.take("10.0.0.1", t0)).ok).toBe(true);
    expect(await lim.take("10.0.0.1", t0)).toMatchObject({ ok: false, scope: "daily", retryAfterSec: 60 });
    expect((await lim.take("10.0.0.1", Date.parse("2026-10-28T15:00:00Z"))).ok).toBe(true);
  });

  it("daily checked after global", async () => {
    const lim = createRateLimiter({ ...base, globalPerMin: 1, dailyCap: 1 });
    expect((await lim.take("10.0.0.1", t)).ok).toBe(true);
    expect(await lim.take("10.0.0.2", t)).toMatchObject({ ok: false, scope: "global" });
  });

  it("xff client index", () => {
    const req = {
      socket: { remoteAddress: "127.0.0.1" },
      headers: { "x-forwarded-for": "198.51.100.7, 203.0.113.5" },
    };
    const resolver = (n: number) => createClientKeyResolver({
      trustProxy: "xff",
      trustedProxyCidrs: ["127.0.0.0/8"],
      xffClientIndexFromRight: n,
    });
    expect(resolver(1)(req)).toBe("203.0.113.5");
    expect(resolver(2)(req)).toBe("198.51.100.7");
    expect(resolver(3)(req)).toBe("127.0.0.1");
    expect(resolver(2)({ socket: { remoteAddress: "8.8.8.8" }, headers: req.headers })).toBe("8.8.8.8");
  });

  it("client key resolver", () => {
    const req = (addr: string, xff?: string) => ({
      socket: { remoteAddress: addr },
      headers: xff ? { "x-forwarded-for": xff } : {},
    });
    const trusted = ["127.0.0.0/8", "10.0.0.0/8"];
    const none = createClientKeyResolver({ trustProxy: "none", trustedProxyCidrs: trusted });
    const xff = createClientKeyResolver({ trustProxy: "xff", trustedProxyCidrs: trusted });

    expect(none(req("127.0.0.1", "203.0.113.5"))).toBe("127.0.0.1");
    expect(xff(req("127.0.0.1", "203.0.113.5"))).toBe("203.0.113.5");
    expect(xff(req("198.51.100.1", "203.0.113.5"))).toBe("198.51.100.1");
    expect(xff(req("::ffff:127.0.0.1", "1.1.1.1, 203.0.113.5"))).toBe("203.0.113.5");
    expect(xff(req("127.0.0.1", "not-an-ip"))).toBe("127.0.0.1");
    expect(
      xff({ socket: { remoteAddress: "127.0.0.1" }, headers: { "x-real-ip": "203.0.113.9" } }),
    ).toBe("127.0.0.1");
  });

  it("idle entries are swept by timer within 2 minutes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(t);
    const lim = createRateLimiter(base);
    await lim.take("1.2.3.4", Date.now());
    expect(lim.trackedClients).toBe(1);
    vi.advanceTimersByTime(31_000);
    expect(lim.trackedClients).toBe(1);
    vi.advanceTimersByTime(89_000);
    expect(lim.trackedClients).toBe(0);
    vi.useRealTimers();
  });
});
