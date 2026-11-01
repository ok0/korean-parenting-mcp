import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CHECKUP_PAGE_ROWS,
  CHECKUP_UNQUERYABLE_CODES,
  checkupRegionParams,
  lookupCheckupClinics,
  toCheckupClinic,
} from "../src/clinic/checkup-lookup.js";
import type { ToolContext } from "../src/core/context.js";
import { ToolError } from "../src/core/errors.js";
import { normalizeRegion, type Region } from "../src/region/normalize.js";
import { createTestContext } from "./helpers/context.js";
import { nemcXml, TEST_KEY } from "./helpers/nemc-mock.js";

const fx = (name: string): string =>
  readFileSync(new URL("./fixtures/data-go-kr/checkupClinic/" + name, import.meta.url), "utf8");

function mockFetch(respond: (href: string, n: number) => Response | Promise<Response>): { fetch: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const fetchFn = (async (input: string | URL | Request) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    urls.push(href);
    return respond(href, urls.length);
  }) as unknown as typeof fetch;
  return { fetch: fetchFn, urls };
}

const xml = (text: string, status = 200): Response =>
  new Response(text, { status, headers: { "content-type": "application/xml; charset=utf-8" } });

const ctx = (fetch: typeof globalThis.fetch): ToolContext => ({
  ...createTestContext({ env: { DATA_GO_KR_SERVICE_KEY: TEST_KEY } }),
  fetch,
});

const regionOf = (input: string): Region => {
  const r = normalizeRegion(input);
  if (!r.ok) throw new Error(`normalize failed: ${input}`);
  return r.region;
};

describe("checkupRegionParams", () => {
  it("maps 2+3 and rejects unqueryable codes", () => {
    expect(checkupRegionParams(regionOf("동작구"))).toEqual({ ok: true, siDoCd: "11", siGunGuCd: "590" });
    expect(checkupRegionParams(regionOf("수원시 영통구"))).toEqual({ ok: true, siDoCd: "41", siGunGuCd: "117" });
    expect(checkupRegionParams(regionOf("수원시"))).toEqual({ ok: false, reason: "city-split" });
    expect(checkupRegionParams(regionOf("경기도"))).toEqual({ ok: false, reason: "sido-only" });
    expect(checkupRegionParams({ sido: "서울특별시", code: "11000" })).toEqual({ ok: false, reason: "sido-only" });
    expect(checkupRegionParams({ sido: "x", code: "1159" })).toEqual({ ok: false, reason: "sido-only" });
    expect(checkupRegionParams(regionOf("세종시"))).toEqual({ ok: true, siDoCd: "36", siGunGuCd: "110" });
  });
});

describe("unqueryable codes", () => {
  it("are 13 and all exist in regions.json", () => {
    expect(CHECKUP_UNQUERYABLE_CODES.size).toBe(13);
    const regions = JSON.parse(
      readFileSync(fileURLToPath(new URL("../data/regions.json", import.meta.url)), "utf8"),
    ) as { sigungu: { code: string }[] };
    const known = new Set(regions.sigungu.map((g) => g.code));
    for (const code of CHECKUP_UNQUERYABLE_CODES) expect(known.has(code)).toBe(true);
  });

  const notePath = fileURLToPath(new URL("../.docs/api-notes/nhis-checkup.md", import.meta.url));
  it.skipIf(!existsSync(notePath))("match the M41 record", () => {
    const line = readFileSync(notePath, "utf8").split("\n").find((l) => l.includes("regions.json에만 있는 13개"));
    expect(line).toBeDefined();
    const codes = ((line ?? "").split("API는")[0] ?? "").match(/\b\d{5}\b/g) ?? [];
    expect([...codes].sort()).toEqual([...CHECKUP_UNQUERYABLE_CODES].sort());
  });
});

describe("toCheckupClinic", () => {
  it("normalizes fields from the first dongjak item", async () => {
    const m = mockFetch(() => xml(fx("dongjak.xml")));
    const r = await lookupCheckupClinics(ctx(m.fetch), { siDoCd: "11", siGunGuCd: "590" });
    expect(r.items[0]).toEqual({
      name: "중앙대학교병원",
      kind: "종합병원",
      address: "서울특별시 동작구 흑석로 102 (흑석동)",
      phone: "1800-1114",
      infant: true,
      oral: true,
    });
  });

  it("falls back to exmdrTelNo and strips leading dashes, ignores other flags", () => {
    expect(toCheckupClinic({ hmcNm: "A", exmdrTelNo: "-1577-0075", ichkChrgTypeCd: "9", mchkChrgTypeCd: "0" })).toEqual({
      name: "A",
      phone: "1577-0075",
      infant: false,
      oral: false,
    });
  });

  it("returns undefined for a blank name", () => {
    expect(toCheckupClinic({ hmcNm: " " })).toBeUndefined();
  });

  it("treats a missing flag as false", () => {
    expect(toCheckupClinic({ hmcNm: "B", ichkChrgTypeCd: "1" })).toEqual({ name: "B", infant: true, oral: false });
  });
});

describe("lookupCheckupClinics", () => {
  it("sends one first-page request", async () => {
    const m = mockFetch(() => xml(fx("dongjak.xml")));
    const c = ctx(m.fetch);
    const r = await lookupCheckupClinics(c, { siDoCd: "11", siGunGuCd: "590" });
    expect(m.urls).toHaveLength(1);
    const url = new URL(m.urls[0] ?? "");
    expect(url.pathname.endsWith("/B550928/HmcSearchService/getRegnHmcList")).toBe(true);
    expect(url.searchParams.get("siDoCd")).toBe("11");
    expect(url.searchParams.get("siGunGuCd")).toBe("590");
    expect(url.searchParams.get("pageNo")).toBe("1");
    expect(url.searchParams.get("numOfRows")).toBe(String(CHECKUP_PAGE_ROWS));
    expect(url.searchParams.get("serviceKey")).toBe(TEST_KEY);
    expect(r.total).toBe(225);
    expect(r.received).toBe(5);
    expect(r.items).toHaveLength(5);
  });

  it("uses the cache on an identical second call", async () => {
    const m = mockFetch(() => xml(fx("dongjak.xml")));
    const c = ctx(m.fetch);
    await lookupCheckupClinics(c, { siDoCd: "11", siGunGuCd: "590" });
    await lookupCheckupClinics(c, { siDoCd: "11", siGunGuCd: "590" });
    expect(m.urls).toHaveLength(1);
  });

  it("parses a single-item response", async () => {
    const m = mockFetch(() => xml(nemcXml([{ hmcNm: "단건", ichkChrgTypeCd: "1" }])));
    const r = await lookupCheckupClinics(ctx(m.fetch), { siDoCd: "11", siGunGuCd: "590" });
    expect(r.items).toHaveLength(1);
  });

  it("propagates ToolError with KEY_INVALID", async () => {
    const m = mockFetch(() => xml(fx("error-bad-key.xml"), 403));
    const err = await lookupCheckupClinics(ctx(m.fetch), { siDoCd: "11", siGunGuCd: "590" }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ToolError);
    expect((err as ToolError).kind).toBe("KEY_INVALID");
  });
});
