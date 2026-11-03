import { describe, expect, it } from "vitest";
import { callDataGoKr } from "../src/clients/data-go-kr.js";
import { SPECS } from "../src/clients/data-go-kr-specs.js";
import { CACHE_TTL_MS } from "../src/core/cache-ttl.js";
import { ToolError } from "../src/core/errors.js";
import { createTestContext } from "./helpers/context.js";

const ctxWith = (text: string, status = 200) => ({
  ...createTestContext({ env: { DATA_GO_KR_SERVICE_KEY: "test-key-0000" } }),
  fetch: (async () =>
    new Response(text, { status, headers: { "content-type": "application/xml; charset=utf-8" } })) as unknown as typeof fetch,
});

const lcgv = (c: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><wantedList><totalCount>0</totalCount><pageNo>0</pageNo><numOfRows>0</numOfRows><resultCode>${c}</resultCode><resultMessage>T</resultMessage></wantedList>`;

const S = { ...SPECS.lcgvList };
const N = { ...SPECS.lcgvList, id: "noEmpty", emptyCodes: undefined };

const errOf = (p: Promise<unknown>): Promise<ToolError> =>
  p.then(
    () => {
      throw new Error("resolved");
    },
    (e: unknown) => e as ToolError,
  );

describe("data.go.kr emptyCodes", () => {
  it("emptyCodes 40 returns zero items without error", async () => {
    const r = await callDataGoKr(S, { ctpvNm: "x" }, ctxWith(lcgv("40")));
    expect(r).toEqual({ items: [], totalCount: 0, fromCache: false });
  });

  it("spec without emptyCodes keeps 40 as UPSTREAM", async () => {
    const e = await errOf(callDataGoKr(N, { ctpvNm: "x" }, ctxWith(lcgv("40"))));
    expect(e).toBeInstanceOf(ToolError);
    expect(e.kind).toBe("UPSTREAM");
    expect(e.detail).toEqual({ code: "40" });
  });

  it("emptyCodes ignores non-2xx", async () => {
    const e = await errOf(callDataGoKr(S, { ctpvNm: "x" }, ctxWith(lcgv("40"), 500)));
    expect(e).toBeInstanceOf(ToolError);
    expect(e.kind).toBe("UPSTREAM");
  });

  it("99 stays UPSTREAM with emptyCodes", async () => {
    const e = await errOf(callDataGoKr(S, { ctpvNm: "x" }, ctxWith(lcgv("99"))));
    expect(e).toBeInstanceOf(ToolError);
    expect(e.kind).toBe("UPSTREAM");
    expect(e.detail).toEqual({ code: "99" });
  });

  it("lcgv TTL constants and specs", () => {
    expect(CACHE_TTL_MS.localSupportList).toBe(43_200_000);
    expect(CACHE_TTL_MS.localSupportDetail).toBe(86_400_000);
    expect(SPECS.lcgvList.cacheTtlMs).toBe(CACHE_TTL_MS.localSupportList);
    expect(SPECS.lcgvDetail.cacheTtlMs).toBe(CACHE_TTL_MS.localSupportDetail);
    expect(SPECS.lcgvList.emptyCodes).toEqual(["40"]);
    expect(SPECS.lcgvDetail.operation).toBe("LcgvWelfaredetailed");
  });

  it("other specs have no emptyCodes", () => {
    for (const spec of Object.values(SPECS)) {
      if (spec.id === "lcgvList" || spec.id === "lcgvDetail") continue;
      expect(spec.emptyCodes).toBeUndefined();
    }
  });
});
