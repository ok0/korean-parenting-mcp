import { describe, expect, it } from "vitest";
import { httpGet } from "../src/core/http.js";
import { ToolError } from "../src/core/errors.js";
import { createUpstreamGuard, defaultQuotaConfig, type UpstreamGuard } from "../src/core/upstream-guard.js";
import { createTestContext } from "./helpers/context.js";

type Mock = { fetch: typeof fetch; calls: number };

function mockFetch(...steps: Array<() => Promise<Response>>): Mock {
  const mock: Mock = { calls: 0, fetch: undefined as unknown as typeof fetch };
  mock.fetch = (async () => {
    const step = steps[Math.min(mock.calls, steps.length - 1)];
    mock.calls += 1;
    return step!();
  }) as typeof fetch;
  return mock;
}

const ok = (body: string) => async () => new Response(body);
const status = (code: number) => async () => new Response("err", { status: code });

const URL_LAW = new URL("https://www.law.go.kr/DRF/lawSearch.do?OC=abcd1234&query=x");
const clock = { now: () => new Date("2026-10-28T21:30:00+09:00") };

describe("httpGet with upstream guard", () => {
  it("admit once per attempt including retry", async () => {
    const mock = mockFetch(status(503), ok("{}"));
    const admitted: string[] = [];
    const spy = {
      admit: async (u: URL) => {
        admitted.push(u.href);
      },
    } as unknown as UpstreamGuard;
    const ctx = { ...createTestContext(), fetch: mock.fetch, upstream: spy, clock };
    const res = await httpGet(URL_LAW, ctx, { retryDelayMs: 1 });
    expect(res.status).toBe(200);
    expect(admitted.length).toBe(2);
    expect(mock.calls).toBe(2);
  });

  it("guard rejection prevents fetch and is not retried", async () => {
    const mock = mockFetch(ok("{}"));
    const rejection = new ToolError("DAILY_LIMIT", "x", { detail: { source: "guard", bucket: "law" } });
    const spy = {
      admit: async () => {
        throw rejection;
      },
    } as unknown as UpstreamGuard;
    const ctx = { ...createTestContext(), fetch: mock.fetch, upstream: spy, clock };
    const err = await httpGet(URL_LAW, ctx, { retryDelayMs: 1 }).catch((e: unknown) => e);
    expect(err).toBe(rejection);
    expect(mock.calls).toBe(0);
  });

  it("real guard budget counts attempts", async () => {
    const mock = mockFetch(status(503), status(503));
    const quota = defaultQuotaConfig();
    const guard = createUpstreamGuard({ ...quota, budgets: { ...quota.budgets, law: 2 } });
    const ctx = { ...createTestContext(), fetch: mock.fetch, upstream: guard, clock };
    const first = await httpGet(URL_LAW, ctx, { retries: 1, retryDelayMs: 1 }).catch((e: unknown) => e);
    expect(first).toBeInstanceOf(ToolError);
    expect((first as ToolError).kind).toBe("UPSTREAM");
    expect(mock.calls).toBe(2);

    const second = await httpGet(URL_LAW, ctx, { retries: 1, retryDelayMs: 1 }).catch((e: unknown) => e);
    expect(second).toBeInstanceOf(ToolError);
    expect((second as ToolError).kind).toBe("DAILY_LIMIT");
    expect(mock.calls).toBe(2);
  });

  it("no guard means no clock needed", async () => {
    const mock = mockFetch(ok("{}"));
    const ctx = { ...createTestContext(), fetch: mock.fetch };
    const res = await httpGet(URL_LAW, ctx, { retryDelayMs: 1 });
    expect(res.status).toBe(200);
    expect(mock.calls).toBe(1);
  });
});
