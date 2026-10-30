// fixture는 명세 예시 기반이며 실호출 기록이 아님. M14 실응답으로 교체 예정.
import { readFileSync } from "node:fs";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { callSafetyKorea, SK_BASE_URL, SK_SPECS, type SkService } from "../src/clients/safetykorea.js";
import { ToolError } from "../src/core/errors.js";
import { runTool } from "../src/core/pipeline.js";
import { defineTool } from "../src/tools/registry.js";
import { createTestContext } from "./helpers/context.js";

const fx = (name: string): string => readFileSync(new URL(`./fixtures/safetykorea/${name}`, import.meta.url), "utf8");

const SK = "Sk+id/=7 Q&z9";
const FORMS = [SK, encodeURIComponent(SK), new URLSearchParams({ x: SK }).toString().slice(2)];
const ENV = { SAFETYKOREA_AUTH_KEY: SK };

const json = (text: string, status = 200): Response =>
  new Response(text, { status, headers: { "content-type": "application/json; charset=utf-8" } });
const html = (text: string, status = 200): Response =>
  new Response(text, { status, headers: { "content-type": "text/html; charset=utf-8" } });

function mockFetch(respond: (href: string, n: number) => Response | Promise<Response>): {
  fetch: typeof fetch;
  calls: { href: string; headers: Record<string, string> | undefined }[];
} {
  const calls: { href: string; headers: Record<string, string> | undefined }[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ href, headers: init?.headers as Record<string, string> | undefined });
    return respond(href, calls.length);
  }) as unknown as typeof fetch;
  return { fetch: fetchFn, calls };
}

function makeCtx(fetchFn: typeof globalThis.fetch, env: Record<string, string> = ENV) {
  let now = Date.parse("2026-01-01T00:00:00+09:00");
  const lines: string[] = [];
  const ctx = { ...createTestContext({ env, sink: (l) => lines.push(l) }), fetch: fetchFn, clock: { now: () => new Date(now) } };
  return {
    ctx,
    lines,
    advance(ms: number) {
      now += ms;
    },
  };
}

async function errOf(p: Promise<unknown>): Promise<ToolError> {
  try {
    await p;
  } catch (err) {
    if (err instanceof ToolError) return err;
    throw err;
  }
  throw new Error("expected rejection");
}

const fxSk = defineTool({
  name: "fx_sk",
  title: "SafetyKorea 클라이언트 (테스트)",
  description: "테스트 전용 도구입니다.",
  schema: z.object({}),
  annotations: { readOnlyHint: true as const, idempotentHint: true, openWorldHint: false },
  requiredKeys: ["SAFETYKOREA"],
  handler: async (_a, ctx) => ({ body: JSON.stringify((await callSafetyKorea("recallList", "유모차", ctx)).items) }),
});

describe("request", () => {
  it("sends https GET with AuthKey header and no key in the URL", async () => {
    const { fetch, calls } = mockFetch(() => json(fx("recallList.json")));
    const { ctx } = makeCtx(fetch);
    await callSafetyKorea("recallList", "유아 카시트 & 쿠션", ctx);
    const href = calls[0]!.href;
    const u = new URL(href);
    expect(u.protocol).toBe("https:");
    expect(u.host).toBe("www.safetykorea.kr");
    expect(u.pathname).toBe("/openapi/api/recall/recallList.json");
    expect(Object.keys(calls[0]!.headers!)).toEqual(["AuthKey"]);
    expect(calls[0]!.headers!.AuthKey).toBe(SK);
    expect(u.searchParams.get("conditionKey")).toBe("recallProductName");
    expect(u.searchParams.get("conditionValue")).toBe("유아 카시트 & 쿠션");
    expect(href.split("conditionValue=").length).toBe(2);
    expect(href.split("conditionKey=").length).toBe(2);
    expect(href.includes("%25")).toBe(false);
    for (const f of FORMS) expect(href.includes(f)).toBe(false);
  });

  it("requests the spec path for each service", async () => {
    const cases: [SkService, string, string][] = [
      ["recallList", "recallList.json", "/openapi/api/recall/recallList.json"],
      ["fRecallList", "fRecallList.json", "/openapi/api/recall/fRecallList.json"],
      ["overseasList", "overseasList.json", "/openapi/api/recall/overseasList.json"],
      ["certificationList", "certificationList.json", "/openapi/api/cert/certificationList.json"],
    ];
    for (const [service, file, pathname] of cases) {
      const { fetch, calls } = mockFetch(() => json(fx(file)));
      const { ctx } = makeCtx(fetch);
      const r = await callSafetyKorea(service, "테스트", ctx);
      expect(new URL(calls[0]!.href).pathname).toBe(pathname);
      expect(r.items.length).toBeGreaterThan(0);
      expect(r.capped).toBe(false);
      expect(r.fromCache).toBe(false);
      expect(new URL(calls[0]!.href).searchParams.get("conditionKey")).toBe(SK_SPECS[service].productKey);
    }
  });

  it("uses an explicit conditionKey when given", async () => {
    const { fetch, calls } = mockFetch(() => json(fx("certificationList.json")));
    const { ctx } = makeCtx(fetch);
    await callSafetyKorea("certificationList", "CB123A123-1234", ctx, "certNum");
    expect(new URL(calls[0]!.href).searchParams.get("conditionKey")).toBe("certNum");
  });

  it("marks every service spec unconfirmed and https", () => {
    expect(Object.values(SK_SPECS).every((s) => s.confirmed === false)).toBe(true);
    expect(SK_BASE_URL.startsWith("https://")).toBe(true);
    expect(Object.values(SK_SPECS).map((s) => s.uidField)).toEqual(["recallUid", "fRecallUid", "overseasUid", "certUid"]);
  });

  it("rejects with MISSING_KEY without fetching when key is absent", async () => {
    const spy = mockFetch(() => json(fx("recallList.json")));
    const { ctx } = makeCtx(spy.fetch, {});
    const e = await errOf(callSafetyKorea("recallList", "유모차", ctx));
    expect(e.kind).toBe("MISSING_KEY");
    expect(spy.calls.length).toBe(0);
    expect(e.message).toContain("SAFETYKOREA_AUTH_KEY");
    expect(e.actions.join()).toContain("AuthKey");
    expect(e.actions.join()).toContain("승인");
  });
});

describe("result codes", () => {
  it("parses 2000 with array resultData", async () => {
    const { ctx } = makeCtx(mockFetch(() => json(fx("recallList.json"))).fetch);
    const r = await callSafetyKorea("recallList", "유모차", ctx);
    expect(r.items.length).toBe(2);
    expect(r.items[0]?.recallUid).toBe("3802");
  });

  it("wraps a single resultData object into a one-element array and accepts numeric resultCode", async () => {
    const { ctx } = makeCtx(mockFetch(() => json('{"resultCode":2000,"resultMsg":"Success.","resultData":{"certUid":3512259}}')).fetch);
    const r = await callSafetyKorea("certificationList", "x", ctx);
    expect(r.items.length).toBe(1);
  });

  it("returns empty items for 2004", async () => {
    const { ctx } = makeCtx(mockFetch(() => json(fx("empty-2004.json"))).fetch);
    const r = await callSafetyKorea("recallList", "유모차", ctx);
    expect(r.items).toEqual([]);
  });

  it("maps error-code fixtures to kinds", async () => {
    const e4000 = await errOf(callSafetyKorea("recallList", "a", makeCtx(mockFetch(() => json(fx("error-4000.json"))).fetch).ctx));
    expect(e4000.kind).toBe("KEY_INVALID");

    const e4001 = await errOf(callSafetyKorea("recallList", "a", makeCtx(mockFetch(() => json(fx("error-4001.json"))).fetch).ctx));
    expect(e4001.kind).toBe("NOT_APPROVED");
    expect(e4001.message + e4001.actions.join()).not.toContain("고정 IP");

    const e4005 = await errOf(callSafetyKorea("recallList", "a", makeCtx(mockFetch(() => json(fx("error-4005.json"))).fetch).ctx));
    expect(e4005.kind).toBe("UPSTREAM");
    expect(e4005.message).toContain("4005");

    const e5000 = await errOf(callSafetyKorea("recallList", "a", makeCtx(mockFetch(() => json(fx("error-5000.json"))).fetch).ctx));
    expect(e5000.kind).toBe("UPSTREAM");
    expect(e5000.message).toContain("5000");
  });

  it("prefers the result code in a non-2xx JSON body", async () => {
    const e401 = await errOf(
      callSafetyKorea("recallList", "a", makeCtx(mockFetch(() => json(fx("error-4001.json"), 401)).fetch).ctx),
    );
    expect(e401.kind).toBe("NOT_APPROVED");

    const e500 = await errOf(
      callSafetyKorea("recallList", "a", makeCtx(mockFetch(() => json(fx("error-5000.json"), 500)).fetch).ctx),
    );
    expect(e500.kind).toBe("UPSTREAM");
    expect(e500.message).toContain("5000");
  });

  it("maps HTTP 401 and 403 without a result code to KEY_INVALID", async () => {
    const e401 = await errOf(callSafetyKorea("recallList", "a", makeCtx(mockFetch(() => html("<html></html>", 401)).fetch).ctx));
    expect(e401.kind).toBe("KEY_INVALID");
    const e403 = await errOf(callSafetyKorea("recallList", "a", makeCtx(mockFetch(() => json("{}", 403)).fetch).ctx));
    expect(e403.kind).toBe("KEY_INVALID");
  });

  it("maps HTML 200, broken JSON, empty body and missing resultCode to UPSTREAM", async () => {
    const bodies = [html("<!DOCTYPE html><html></html>"), json("{bad"), json(""), json('{"resultMsg":"x"}')];
    for (const res of bodies) {
      const e = await errOf(callSafetyKorea("recallList", "a", makeCtx(mockFetch(() => res).fetch).ctx));
      expect(e.kind).toBe("UPSTREAM");
    }
  });

  it("maps a never-resolving fetch to TIMEOUT quickly", async () => {
    const { ctx } = makeCtx(mockFetch(() => new Promise<Response>(() => {})).fetch, { ...ENV, KPM_HTTP_TIMEOUT_MS: "1000" });
    const started = Date.now();
    const e = await errOf(callSafetyKorea("recallList", "a", ctx));
    expect(e.kind).toBe("TIMEOUT");
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("maps a network error to UPSTREAM", async () => {
    const { ctx } = makeCtx(
      mockFetch(() => {
        throw new TypeError("fetch failed");
      }).fetch,
    );
    const e = await errOf(callSafetyKorea("recallList", "a", ctx));
    expect(e.kind).toBe("UPSTREAM");
  });

  it("returns isError text through runTool", async () => {
    const { ctx } = makeCtx(mockFetch(() => json(fx("error-4000.json"))).fetch);
    const res = await runTool(fxSk, {}, ctx);
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain("KEY_INVALID");
    expect(res.content[0]?.text).toContain("SAFETYKOREA_AUTH_KEY");
  });
});

describe("cap", () => {
  // 명세 "최대 1,000줄" 상한 시험용 생성 fixture(recallList 첫 항목 복제)
  const sampleItem = (JSON.parse(fx("recallList.json")) as { resultData: unknown[] }).resultData[0];
  const bodyWithRows = (n: number): string =>
    JSON.stringify({ resultCode: "2000", resultMsg: "Success", resultData: Array.from({ length: n }, () => ({ ...(sampleItem as object) })) });

  it("sets capped at 1000 items and not at 999", async () => {
    const at1000 = await callSafetyKorea("recallList", "a", makeCtx(mockFetch(() => json(bodyWithRows(1000))).fetch).ctx);
    expect(at1000.items.length).toBe(1000);
    expect(at1000.capped).toBe(true);
    const at999 = await callSafetyKorea("recallList", "a", makeCtx(mockFetch(() => json(bodyWithRows(999))).fetch).ctx);
    expect(at999.items.length).toBe(999);
    expect(at999.capped).toBe(false);
  });
});

describe("cache", () => {
  it("serves the second identical request from cache within 24h", async () => {
    const m = mockFetch(() => json(fx("recallList.json")));
    const { ctx } = makeCtx(m.fetch);
    await callSafetyKorea("recallList", "유모차", ctx);
    const second = await callSafetyKorea("recallList", "유모차", ctx);
    expect(m.calls.length).toBe(1);
    expect(second.fromCache).toBe(true);
  });

  it("refetches after 24h", async () => {
    const m = mockFetch(() => json(fx("recallList.json")));
    const { ctx, advance } = makeCtx(m.fetch);
    await callSafetyKorea("recallList", "유모차", ctx);
    advance(24 * 3_600_000);
    await callSafetyKorea("recallList", "유모차", ctx);
    expect(m.calls.length).toBe(2);
  });

  it("calls again for a different condition value", async () => {
    const m = mockFetch(() => json(fx("recallList.json")));
    const { ctx } = makeCtx(m.fetch);
    await callSafetyKorea("recallList", "유모차", ctx);
    await callSafetyKorea("recallList", "카시트", ctx);
    expect(m.calls.length).toBe(2);
  });

  it("does not cache error responses", async () => {
    const responses: Array<() => Response> = [
      () => json(fx("error-4000.json")),
      () => json(fx("error-5000.json"), 500),
      () => html("<!DOCTYPE html><html></html>"),
    ];
    for (const make of responses) {
      const m = mockFetch(() => make());
      const { ctx } = makeCtx(m.fetch);
      await errOf(callSafetyKorea("recallList", "유모차", ctx));
      await errOf(callSafetyKorea("recallList", "유모차", ctx));
      expect(m.calls.length).toBe(2);
    }
  });

  it("caches 2004 as a normal empty result", async () => {
    const m = mockFetch(() => json(fx("empty-2004.json")));
    const { ctx } = makeCtx(m.fetch);
    await callSafetyKorea("recallList", "유모차", ctx);
    await callSafetyKorea("recallList", "유모차", ctx);
    expect(m.calls.length).toBe(1);
  });

  it("keeps key forms out of cache keys", async () => {
    const m = mockFetch(() => json(fx("recallList.json")));
    const { ctx } = makeCtx(m.fetch);
    await callSafetyKorea("recallList", "유모차", ctx);
    const keys = ctx.cache.keys();
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) {
      expect(k.startsWith("sk:recallList?")).toBe(true);
      for (const f of FORMS) expect(k.includes(f)).toBe(false);
    }
  });
});

describe("leak", () => {
  it("never leaks key forms into results, tool text, errors or logs", async () => {
    const responders: Array<(href: string, n: number) => Response | Promise<Response>> = [
      () => json(fx("recallList.json")),
      () => json(fx("error-4000.json")),
      () => json(fx("error-4001.json")),
      () => json(fx("error-4005.json")),
      () => json(fx("error-5000.json")),
      () => json(fx("empty-2004.json")),
      () => html("<!DOCTYPE html><html><body>x</body></html>"),
      () => {
        throw new TypeError("fetch failed");
      },
    ];
    for (const respond of responders) {
      const m = mockFetch(respond);
      const { ctx, lines } = makeCtx(m.fetch);
      const texts: string[] = [];
      const res = await runTool(fxSk, {}, ctx);
      texts.push(res.content[0]?.text ?? "");
      try {
        texts.push(JSON.stringify(await callSafetyKorea("recallList", "유모차", ctx)));
      } catch (err) {
        const e = err as ToolError;
        texts.push(String(e.message), e.actions.join("\n"));
      }
      const all = [...texts, ...lines, ...m.calls.map((c) => c.href)].join("\n");
      for (const f of FORMS) expect(all).not.toContain(f);
      for (const line of lines) expect(line).not.toContain("AuthKey");
    }
  });
});
