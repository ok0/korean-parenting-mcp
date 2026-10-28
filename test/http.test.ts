import { describe, expect, it } from "vitest";
import { httpGet } from "../src/core/http.js";
import { ToolError } from "../src/core/errors.js";
import type { ToolContext } from "../src/core/context.js";
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

const ok = (body: string, headers: Record<string, string> = {}) => async () => new Response(body, { headers });
const status = (code: number) => async () => new Response("err", { status: code });
const netFail = () => async () => {
  throw new TypeError("fetch failed https://x?OC=secret");
};

function makeCtx(mock: Mock, sink?: (line: string) => void, env: Record<string, string> = {}): ToolContext {
  return { ...createTestContext({ env, sink }), fetch: mock.fetch };
}

const URL_OK = new URL("https://www.law.go.kr/DRF/lawSearch.do?OC=abcd1234&query=x");

describe("httpGet", () => {
  it("returns text, status and content type on 200", async () => {
    const mock = mockFetch(ok("{}", { "content-type": "application/json" }));
    const res = await httpGet(URL_OK, makeCtx(mock), { retryDelayMs: 5 });
    expect(res).toEqual({ status: 200, contentType: "application/json", text: "{}" });
  });

  it("retries once on 503 then succeeds", async () => {
    const mock = mockFetch(status(503), ok("{}"));
    const res = await httpGet(URL_OK, makeCtx(mock), { retryDelayMs: 5 });
    expect(res.status).toBe(200);
    expect(mock.calls).toBe(2);
  });

  it("retries once on network error then UPSTREAM", async () => {
    const mock = mockFetch(netFail());
    const err = await httpGet(URL_OK, makeCtx(mock), { retryDelayMs: 5 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ToolError);
    expect((err as ToolError).kind).toBe("UPSTREAM");
    expect(mock.calls).toBe(2);
    expect((err as ToolError).message).not.toContain("secret");
    expect((err as ToolError).message).not.toContain("https://");
  });

  it("HTTP 500 is UPSTREAM without retry", async () => {
    const mock = mockFetch(status(500));
    const err = await httpGet(URL_OK, makeCtx(mock), { retryDelayMs: 5 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ToolError);
    expect((err as ToolError).kind).toBe("UPSTREAM");
    expect((err as ToolError).message).toContain("HTTP 500");
    expect(mock.calls).toBe(1);
  });

  it("HTTP 429 after retry is RATE_LIMIT", async () => {
    const mock = mockFetch(status(429), status(429));
    const err = await httpGet(URL_OK, makeCtx(mock), { retryDelayMs: 5 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ToolError);
    expect((err as ToolError).kind).toBe("RATE_LIMIT");
    expect(mock.calls).toBe(2);
  });

  it("never-resolving fetch times out", async () => {
    const mock: Mock = {
      calls: 0,
      fetch: (() => {
        mock.calls += 1;
        return new Promise<Response>(() => {});
      }) as typeof fetch,
    };
    const started = Date.now();
    const err = await httpGet(URL_OK, makeCtx(mock), { timeoutMs: 50, retryDelayMs: 5 }).catch((e: unknown) => e);
    const elapsed = Date.now() - started;
    expect(err).toBeInstanceOf(ToolError);
    expect((err as ToolError).kind).toBe("TIMEOUT");
    expect(mock.calls).toBe(1);
    expect(elapsed).toBeLessThan(1000);
  });

  it("log lines carry no query string", async () => {
    const lines: string[] = [];
    const mock = mockFetch(status(503), ok("{}"));
    await httpGet(URL_OK, makeCtx(mock, (l) => lines.push(l), { LAW_OC: "abcd1234" }), { retryDelayMs: 5 });
    const mockFail = mockFetch(netFail());
    await httpGet(URL_OK, makeCtx(mockFail, (l) => lines.push(l)), { retryDelayMs: 5 }).catch(() => undefined);
    const all = lines.join("\n");
    expect(all).not.toContain("OC=");
    expect(all).not.toContain("abcd1234");
    expect(all).not.toContain("query=");
  });
});
