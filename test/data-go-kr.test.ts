import { readFileSync, readdirSync } from "node:fs";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { callDataGoKr, type ApiSpec } from "../src/clients/data-go-kr.js";
import { SPECS } from "../src/clients/data-go-kr-specs.js";
import { ToolError } from "../src/core/errors.js";
import { runTool } from "../src/core/pipeline.js";
import { defineTool } from "../src/tools/registry.js";
import { findLeaks } from "../scripts/lib/sample-mask.js";
import { createTestContext } from "./helpers/context.js";

const fx = (name: string): string => readFileSync(new URL(`./fixtures/data-go-kr/${name}`, import.meta.url), "utf8");

const K = "Ab+cD/eF=gH+iJ k/L==";
const FORMS = [K, encodeURIComponent(K), new URLSearchParams({ x: K }).toString().slice(2)];
const ENV = { DATA_GO_KR_SERVICE_KEY: K };

const TEST_SPEC: ApiSpec = {
  id: "test",
  title: "테스트 API",
  datasetUrl: "https://www.data.go.kr/data/0/openapi.do",
  attribution: "테스트",
  baseUrl: "https://apis.data.go.kr/TEST/Service",
  operation: "getList",
  itemsPath: ["response", "body", "items", "item"],
  totalCountPath: ["response", "body", "totalCount"],
  resultCodePath: ["response", "header", "resultCode"],
  cacheTtlMs: 60_000,
  confirmed: false,
};

const gateway = (c: string): string =>
  `<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnAuthMsg>TEST_ERROR</returnAuthMsg><returnReasonCode>${c}</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>`;
const general = (c: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?><response><header><resultCode>${c}</resultCode><resultMsg>TEST</resultMsg></header><body><items/></body></response>`;
const generalJson = (c: string): string =>
  `{"response":{"header":{"resultCode":"${c}","resultMsg":"TEST"}}}`;

const xml = (text: string, status = 200): Response =>
  new Response(text, { status, headers: { "content-type": "application/xml; charset=utf-8" } });
const json = (text: string, status = 200): Response =>
  new Response(text, { status, headers: { "content-type": "application/json; charset=utf-8" } });
const html = (text: string): Response =>
  new Response(text, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });

function mockFetch(respond: (href: string, n: number) => Response | Promise<Response>): { fetch: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const fetchFn = (async (input: string | URL | Request) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    urls.push(href);
    return respond(href, urls.length);
  }) as unknown as typeof fetch;
  return { fetch: fetchFn, urls };
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

const fxDgk = defineTool({
  name: "fx_dgk",
  title: "공공데이터 클라이언트 (테스트)",
  description: "테스트 전용 도구입니다.",
  schema: z.object({}),
  annotations: { readOnlyHint: true as const, idempotentHint: true, openWorldHint: false },
  requiredKeys: ["DATA_GO_KR"],
  handler: async (_a, ctx) => ({ body: JSON.stringify((await callDataGoKr(TEST_SPEC, { Q0: "서울특별시" }, ctx)).items) }),
});

const CODES = ["20", "22", "23", "30", "31"];
const KINDS = ["NOT_APPROVED", "DAILY_LIMIT", "RATE_LIMIT", "KEY_INVALID", "KEY_EXPIRED"];

describe("data.go.kr error codes", () => {
  it("maps codes 20/22/23/30/31 to kinds for gateway and general shapes", async () => {
    const actions = new Set<string>();
    const messages = new Set<string>();
    for (const shape of [gateway, general]) {
      const kinds: string[] = [];
      for (const c of CODES) {
        const { ctx } = makeCtx(mockFetch(() => xml(shape(c))).fetch);
        const e = await errOf(callDataGoKr(TEST_SPEC, { Q0: "서울특별시" }, ctx));
        kinds.push(e.kind);
        actions.add(e.actions.join("\n"));
        messages.add(e.message);
      }
      expect(kinds).toEqual(KINDS);
    }
    expect(actions.size).toBe(5);
    expect(messages.size).toBe(5);
  });

  it("maps JSON general code to DAILY_LIMIT", async () => {
    const { ctx } = makeCtx(mockFetch(() => json(generalJson("22"))).fetch);
    const e = await errOf(callDataGoKr(TEST_SPEC, { Q0: "서울특별시" }, ctx));
    expect(e.kind).toBe("DAILY_LIMIT");
  });

  it("maps HTTP 401 with gateway code 30 to KEY_INVALID", async () => {
    const { ctx } = makeCtx(mockFetch(() => xml(gateway("30"), 401)).fetch);
    const e = await errOf(callDataGoKr(TEST_SPEC, { Q0: "서울특별시" }, ctx));
    expect(e.kind).toBe("KEY_INVALID");
  });

  it("maps HTTP 500 with non-XML body to UPSTREAM with status in message", async () => {
    const { ctx } = makeCtx(mockFetch(() => new Response("err", { status: 500, headers: { "content-type": "text/plain" } })).fetch);
    const e = await errOf(callDataGoKr(TEST_SPEC, { Q0: "서울특별시" }, ctx));
    expect(e.kind).toBe("UPSTREAM");
    expect(e.message).toContain("HTTP 500");
  });

  it("maps unknown code 99 to UPSTREAM including the code", async () => {
    const { ctx } = makeCtx(mockFetch(() => xml(general("99"))).fetch);
    const e = await errOf(callDataGoKr(TEST_SPEC, { Q0: "서울특별시" }, ctx));
    expect(e.kind).toBe("UPSTREAM");
    expect(e.message).toContain("99");
  });

  it("treats codes 00, 0 and INFO-000 as success with no items", async () => {
    for (const c of ["00", "0", "INFO-000"]) {
      const { ctx } = makeCtx(mockFetch(() => xml(general(c))).fetch);
      const r = await callDataGoKr(TEST_SPEC, { Q0: "서울특별시" }, ctx);
      expect(r.items).toEqual([]);
    }
  });

  it("returns isError with KEY_INVALID text through runTool", async () => {
    const { ctx } = makeCtx(mockFetch(() => xml(gateway("30"))).fetch);
    const res = await runTool(fxDgk, {}, ctx);
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain("KEY_INVALID");
  });
});

describe("data.go.kr request and key handling", () => {
  it("sends the decoding key exactly once in the query", async () => {
    const { fetch, urls } = mockFetch(() => xml(fx("list.xml")));
    const { ctx } = makeCtx(fetch);
    await callDataGoKr(TEST_SPEC, { Q0: "서울특별시" }, ctx);
    const h = urls[0] ?? "";
    expect(new URL(h).searchParams.get("serviceKey")).toBe(K);
    expect(h.split("serviceKey=").length).toBe(2);
    expect(h.split(new URLSearchParams({ serviceKey: K }).toString()).length).toBe(2);
    expect(h.includes("%25")).toBe(false);
    expect(new URL(h).pathname).toBe("/TEST/Service/getList");
    expect(new URL(h).searchParams.get("Q0")).toBe("서울특별시");
  });

  it("never leaks key forms into tool text or logs across scenarios", async () => {
    const scenarios: Array<() => { fetch: typeof fetch }> = [
      () => mockFetch(() => xml(fx("list.xml"))),
      ...CODES.map((c) => () => mockFetch(() => xml(gateway(c)))),
      () => mockFetch(() => html("<!DOCTYPE html><html><body>x</body></html>")),
      () =>
        mockFetch((href) => {
          throw new TypeError("fetch failed " + href);
        }),
    ];
    for (const make of scenarios) {
      const { ctx, lines } = makeCtx(make().fetch);
      const res = await runTool(fxDgk, {}, ctx);
      const all = [res.content[0]?.text ?? "", ...lines].join("\n");
      for (const f of FORMS) expect(all).not.toContain(f);
      for (const line of lines) expect(line).not.toContain("serviceKey");
    }
  });

  it("rejects with MISSING_KEY and does not call fetch when key is absent", async () => {
    const spy = mockFetch(() => xml(fx("list.xml")));
    const { ctx } = makeCtx(spy.fetch, {});
    const e = await errOf(callDataGoKr(TEST_SPEC, { Q0: "서울특별시" }, ctx));
    expect(e.kind).toBe("MISSING_KEY");
    expect(spy.urls.length).toBe(0);
    expect(e.message).toContain("DATA_GO_KR_SERVICE_KEY");
    expect(e.actions.join()).toContain("활용신청");
    expect(e.actions.join()).toContain("Decoding");
  });
});

describe("data.go.kr response parsing", () => {
  it("parses list.xml with string zip and totalCount", async () => {
    const { ctx } = makeCtx(mockFetch(() => xml(fx("list.xml"))).fetch);
    const r = await callDataGoKr(TEST_SPEC, { Q0: "서울특별시" }, ctx);
    expect(r.items.length).toBe(2);
    expect(r.items[0]?.zip).toBe("0123");
    expect(r.totalCount).toBe(2);
  });

  it("parses list.json the same way", async () => {
    const { ctx } = makeCtx(mockFetch(() => json(fx("list.json"))).fetch);
    const r = await callDataGoKr(TEST_SPEC, { Q0: "서울특별시" }, ctx);
    expect(r.items.length).toBe(2);
    expect(r.items[0]?.zip).toBe("0123");
    expect(r.totalCount).toBe(2);
  });

  it("wraps a single XML item into a one-element array", async () => {
    const { ctx } = makeCtx(mockFetch(() => xml(fx("single.xml"))).fetch);
    const r = await callDataGoKr(TEST_SPEC, { Q0: "서울특별시" }, ctx);
    expect(r.items.length).toBe(1);
  });

  it("returns empty items and totalCount 0 for empty XML and JSON", async () => {
    for (const [body, type] of [
      [fx("empty.xml"), "xml"],
      [fx("empty.json"), "json"],
    ] as const) {
      const { ctx } = makeCtx(mockFetch(() => (type === "xml" ? xml(body) : json(body))).fetch);
      const r = await callDataGoKr(TEST_SPEC, { Q0: "서울특별시" }, ctx);
      expect(r.items).toEqual([]);
      expect(r.totalCount).toBe(0);
    }
  });

  it("rejects HTML 200 and empty 200 bodies as UPSTREAM", async () => {
    const h = makeCtx(mockFetch(() => html("<!DOCTYPE html><html><body>x</body></html>")).fetch);
    expect((await errOf(callDataGoKr(TEST_SPEC, { Q0: "a" }, h.ctx))).kind).toBe("UPSTREAM");
    const e = makeCtx(mockFetch(() => new Response("", { status: 200, headers: { "content-type": "application/xml" } })).fetch);
    expect((await errOf(callDataGoKr(TEST_SPEC, { Q0: "a" }, e.ctx))).kind).toBe("UPSTREAM");
  });

  it("maps an aborted request to TIMEOUT quickly", async () => {
    const { ctx } = makeCtx(mockFetch(() => new Promise<Response>(() => {})).fetch, {
      ...ENV,
      KPM_HTTP_TIMEOUT_MS: "1000",
    });
    const started = Date.now();
    const e = await errOf(callDataGoKr(TEST_SPEC, { Q0: "a" }, ctx));
    expect(e.kind).toBe("TIMEOUT");
    expect(Date.now() - started).toBeLessThan(3000);
  });
});

describe("data.go.kr caching", () => {
  it("serves the second identical request from cache", async () => {
    const m = mockFetch(() => xml(fx("list.xml")));
    const { ctx } = makeCtx(m.fetch);
    await callDataGoKr(TEST_SPEC, { Q0: "a" }, ctx);
    const second = await callDataGoKr(TEST_SPEC, { Q0: "a" }, ctx);
    expect(second.fromCache).toBe(true);
    expect(m.urls.length).toBe(1);
  });

  it("treats parameter order as irrelevant", async () => {
    const m = mockFetch(() => xml(fx("list.xml")));
    const { ctx } = makeCtx(m.fetch);
    await callDataGoKr(TEST_SPEC, { a: "1", b: "2" }, ctx);
    await callDataGoKr(TEST_SPEC, { b: "2", a: "1" }, ctx);
    expect(m.urls.length).toBe(1);
  });

  it("refetches after the ttl elapses", async () => {
    const m = mockFetch(() => xml(fx("list.xml")));
    const { ctx, advance } = makeCtx(m.fetch);
    await callDataGoKr(TEST_SPEC, { Q0: "a" }, ctx);
    advance(60_000);
    await callDataGoKr(TEST_SPEC, { Q0: "a" }, ctx);
    expect(m.urls.length).toBe(2);
  });

  it("does not cache when cacheTtlMs is 0", async () => {
    const m = mockFetch(() => xml(fx("list.xml")));
    const { ctx } = makeCtx(m.fetch);
    const spec = { ...TEST_SPEC, cacheTtlMs: 0 };
    await callDataGoKr(spec, { Q0: "a" }, ctx);
    await callDataGoKr(spec, { Q0: "a" }, ctx);
    expect(m.urls.length).toBe(2);
  });

  it("does not cache errors", async () => {
    const m = mockFetch((_h, n) => (n === 1 ? xml(gateway("23")) : xml(fx("list.xml"))));
    const { ctx } = makeCtx(m.fetch);
    const e = await errOf(callDataGoKr(TEST_SPEC, { Q0: "a" }, ctx));
    expect(e.kind).toBe("RATE_LIMIT");
    const ok = await callDataGoKr(TEST_SPEC, { Q0: "a" }, ctx);
    expect(ok.items.length).toBe(2);
    expect(m.urls.length).toBe(2);
  });

  it("shares one in-flight request between concurrent callers", async () => {
    const m = mockFetch(() => xml(fx("list.xml")));
    const { ctx } = makeCtx(m.fetch);
    await Promise.all([
      callDataGoKr(TEST_SPEC, { Q0: "a" }, ctx),
      callDataGoKr(TEST_SPEC, { Q0: "a" }, ctx),
    ]);
    expect(m.urls.length).toBe(1);
  });

  it("keeps key forms out of cache keys", async () => {
    const m = mockFetch(() => xml(fx("list.xml")));
    const { ctx } = makeCtx(m.fetch);
    await callDataGoKr(TEST_SPEC, { Q0: "a" }, ctx);
    for (const k of ctx.cache.keys()) {
      for (const f of FORMS) expect(k.includes(f)).toBe(false);
    }
  });
});

describe("data.go.kr parameter handling", () => {
  it("omits undefined parameters from the query", async () => {
    const m = mockFetch(() => xml(fx("list.xml")));
    const { ctx } = makeCtx(m.fetch);
    await callDataGoKr(TEST_SPEC, { Q0: "서울특별시", QN: undefined }, ctx);
    expect(new URL(m.urls[0] ?? "").searchParams.has("QN")).toBe(false);
  });

  it("adds formatParams to the query", async () => {
    const m = mockFetch(() => json(fx("list.json")));
    const { ctx } = makeCtx(m.fetch);
    await callDataGoKr({ ...TEST_SPEC, formatParams: { _type: "json" } }, { Q0: "a" }, ctx);
    expect(new URL(m.urls[0] ?? "").searchParams.get("_type")).toBe("json");
  });

  it("rejects specs with an empty baseUrl as INTERNAL without fetching", async () => {
    const m = mockFetch(() => xml(fx("list.xml")));
    const { ctx } = makeCtx(m.fetch);
    const e = await errOf(callDataGoKr({ ...TEST_SPEC, baseUrl: "" }, { Q0: "a" }, ctx));
    expect(e.kind).toBe("INTERNAL");
    expect(m.urls.length).toBe(0);
  });
});

describe("live fixtures (M11)", () => {
  it("nemcList seongdong.xml keeps strings and totalCount", async () => {
    const { ctx } = makeCtx(mockFetch(() => xml(fx("nemcList/seongdong.xml"))).fetch);
    const r = await callDataGoKr(SPECS.nemcList, { Q0: "서울특별시", Q1: "성동구" }, ctx);
    expect(r.items).toHaveLength(3);
    expect(r.totalCount).toBe(493);
    for (const item of r.items) expect(typeof item.hpid).toBe("string");
  });

  it("nemcMoonlight json single object item becomes one item", async () => {
    const { ctx } = makeCtx(mockFetch(() => json(fx("nemcMoonlight/json.json"))).fetch);
    const r = await callDataGoKr(SPECS.nemcMoonlight, { Q0: "서울특별시", Q1: "성동구" }, ctx);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]?.dutyName).toBe("365다움의원");
    expect(r.totalCount).toBe(1);
  });

  it("DUR XML body under JSON content-type parses as XML", async () => {
    const { ctx } = makeCtx(mockFetch(() => json(fx("durPregnancy/single.xml"))).fetch);
    const r = await callDataGoKr(SPECS.durPregnancy, { itemName: "이부프로펜" }, ctx);
    expect(r.items).toHaveLength(3);
    expect(r.totalCount).toBe(31);
    expect(r.items[0]?.INGR_NAME).toBe("이부프로펜");
  });

  it("DUR empty result is an empty list", async () => {
    const { ctx } = makeCtx(mockFetch(() => xml(fx("durPregnancy/empty.xml"))).fetch);
    const r = await callDataGoKr(SPECS.durPregnancy, { itemName: "없는성분" }, ctx);
    expect(r.items).toEqual([]);
    expect(r.totalCount).toBe(0);
  });

  it("gateway bad key (HTTP 403 XML, code 30) is KEY_INVALID", async () => {
    const { ctx } = makeCtx(mockFetch(() => xml(fx("nemcList/error-bad-key.xml"), 403)).fetch);
    const e = await errOf(callDataGoKr(SPECS.nemcList, { Q0: "서울특별시", Q1: "성동구" }, ctx));
    expect(e.kind).toBe("KEY_INVALID");
    expect(e.detail?.code).toBe("30");
  });

  it("odcloud list parses data array and totalCount", async () => {
    const { ctx } = makeCtx(mockFetch(() => json(fx("benefitsList/list.json"))).fetch);
    const r = await callDataGoKr(SPECS.benefitsList, { page: 1, perPage: 5 }, ctx);
    expect(r.items).toHaveLength(3);
    expect(r.totalCount).toBe(10946);
    expect(r.items[0]?.["서비스ID"]).toBe("105100000001");
  });

  it("odcloud bad key (HTTP 401, code -4) is KEY_INVALID", async () => {
    const { ctx } = makeCtx(mockFetch(() => json(fx("benefitsList/error-bad-key.json"), 401)).fetch);
    const e = await errOf(callDataGoKr(SPECS.benefitsList, { page: 1, perPage: 5 }, ctx));
    expect(e.kind).toBe("KEY_INVALID");
    expect(e.detail?.code).toBe("-4");
  });
});

describe("live fixtures (M41 checkupClinic)", () => {
  const SPEC = { ...SPECS.checkupClinic, baseUrl: "https://apis.data.go.kr/B550928/HmcSearchService", operation: "getRegnHmcList" };

  it("dongjak.xml parses items and totalCount", async () => {
    const { ctx } = makeCtx(mockFetch(() => xml(fx("checkupClinic/dongjak.xml"))).fetch);
    const r = await callDataGoKr(SPEC, { siDoCd: "11", siGunGuCd: "590" }, ctx);
    expect(r.items).toHaveLength(5);
    expect(r.totalCount).toBe(225);
    for (const item of r.items) {
      expect(typeof item.hmcNm).toBe("string");
      expect(String(item.hmcNm).trim()).not.toBe("");
      expect(typeof item.ykindnm).toBe("string");
      expect(String(item.locAddr)).toContain("동작구");
      expect(typeof item.hmcNo).toBe("string");
    }
    expect(r.items[0]?.hmcNo).toBe("11100052");
    expect(Object.keys(r.items[0] ?? {})).toContain("ichkChrgTypeCd");
    expect(Object.keys(r.items[0] ?? {})).toContain("mchkChrgTypeCd");
  });

  it("yeongtong.xml addresses are 영통구", async () => {
    const { ctx } = makeCtx(mockFetch(() => xml(fx("checkupClinic/yeongtong.xml"))).fetch);
    const r = await callDataGoKr(SPEC, { siDoCd: "41", siGunGuCd: "117" }, ctx);
    expect(r.items).toHaveLength(5);
    expect(r.totalCount).toBe(148);
    for (const item of r.items) expect(String(item.locAddr)).toContain("영통구");
  });

  it("empty.xml is an empty list", async () => {
    const { ctx } = makeCtx(mockFetch(() => xml(fx("checkupClinic/empty.xml"))).fetch);
    const r = await callDataGoKr(SPEC, { siDoCd: "11", siGunGuCd: "590", hmcNm: "없는기관명테스트" }, ctx);
    expect(r.items).toEqual([]);
    expect(r.totalCount).toBe(0);
  });

  it("error-bad-key.xml maps to KEY_INVALID", async () => {
    const { ctx } = makeCtx(mockFetch(() => xml(fx("checkupClinic/error-bad-key.xml"), 403)).fetch);
    const e = await errOf(callDataGoKr(SPEC, { siDoCd: "11", siGunGuCd: "590" }, ctx));
    expect(e.kind).toBe("KEY_INVALID");
    expect(e.detail?.code).toBe("30");
  });

  it("checkupClinic fixtures hold no key-like values", () => {
    const files = readdirSync(new URL("./fixtures/data-go-kr/checkupClinic/", import.meta.url));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const text = fx(`checkupClinic/${f}`);
      expect(findLeaks(text, [], { heuristic: true })).toEqual([]);
      expect(text).not.toMatch(/serviceKey=(?!\*\*\*)/i);
    }
  });
});
