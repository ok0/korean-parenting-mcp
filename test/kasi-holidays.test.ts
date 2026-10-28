import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SPECS } from "../src/clients/data-go-kr-specs.js";
import { fetchKasiHolidays } from "../src/clients/kasi-holidays.js";
import type { ToolContext } from "../src/core/context.js";
import { ToolError } from "../src/core/errors.js";
import { createTestContext } from "./helpers/context.js";
import { createKasiMock, emptyRes, entriesToItems, htmlRes200, kasiXml, xmlRes } from "./helpers/kasi-mock.js";

const fx = (name: string): string => readFileSync(new URL(`./fixtures/data-go-kr/${name}`, import.meta.url), "utf8");

const K = "Ab+cD/eF=gH+iJ k/L==";
const FORMS = (x: string): string[] => [x, encodeURIComponent(x), new URLSearchParams({ k: x }).toString().slice(2)];
const ENV = { DATA_GO_KR_SERVICE_KEY: K };

function ctxWith(fetchImpl: typeof fetch, env: Record<string, string> = ENV): ToolContext {
  return { ...createTestContext({ env }), fetch: fetchImpl };
}

async function catchErr(p: Promise<unknown>): Promise<ToolError> {
  try {
    await p;
  } catch (err) {
    if (err instanceof ToolError) return err;
    throw err;
  }
  throw new Error("expected ToolError");
}

describe("fetchKasiHolidays", () => {
  beforeAll(() => vi.stubGlobal("fetch", () => {
    throw new Error("global fetch disabled");
  }));
  afterAll(() => vi.unstubAllGlobals());

  it("keeps isHoliday=Y only, sorted, deduped, zero-padded", async () => {
    const mock = createKasiMock({ 2026: () => xmlRes(fx("kasi-2026-sample.xml")) });
    const out = await fetchKasiHolidays(2026, ctxWith(mock.fetch));
    expect(out).toEqual([
      { date: "2026-01-01", name: "1월1일" },
      { date: "2026-03-01", name: "삼일절" },
      { date: "2026-05-05", name: "어린이날" },
    ]);
  });

  it("requests a full year in one page", async () => {
    const mock = createKasiMock({ 2026: () => xmlRes(fx("kasi-2026-sample.xml")) });
    await fetchKasiHolidays(2026, ctxWith(mock.fetch));
    const url = new URL(mock.urls[0]!);
    expect(url.host).toBe("apis.data.go.kr");
    expect(url.pathname.endsWith("/getRestDeInfo")).toBe(true);
    expect(url.searchParams.get("solYear")).toBe("2026");
    expect(url.searchParams.get("numOfRows")).toBe("100");
    expect(url.searchParams.get("pageNo")).toBe("1");
  });

  it("missing key throws MISSING_KEY without fetch", async () => {
    const mock = createKasiMock({});
    const err = await catchErr(fetchKasiHolidays(2026, ctxWith(mock.fetch, {})));
    expect(err.kind).toBe("MISSING_KEY");
    expect(mock.urls).toHaveLength(0);
  });

  it("error codes map to M8 kinds", async () => {
    const kinds: string[] = [];
    for (const code of ["20", "22", "30"]) {
      const mock = createKasiMock({ 2026: () => xmlRes(kasiXml([], { resultCode: code })) });
      kinds.push((await catchErr(fetchKasiHolidays(2026, ctxWith(mock.fetch)))).kind);
    }
    expect(kinds).toEqual(["NOT_APPROVED", "DAILY_LIMIT", "KEY_INVALID"]);
    expect(new Set(kinds).size).toBe(3);
  });

  it("html 200 and empty body are UPSTREAM", async () => {
    const htmlMock = createKasiMock({ 2026: () => htmlRes200() });
    const emptyMock = createKasiMock({ 2026: () => emptyRes() });
    expect((await catchErr(fetchKasiHolidays(2026, ctxWith(htmlMock.fetch)))).kind).toBe("UPSTREAM");
    expect((await catchErr(fetchKasiHolidays(2026, ctxWith(emptyMock.fetch)))).kind).toBe("UPSTREAM");
  });

  it("truncated page is UPSTREAM", async () => {
    const items = entriesToItems([{ date: "2026-01-01", name: "1월1일" }]);
    const mock = createKasiMock({ 2026: () => xmlRes(kasiXml(items, { totalCount: 150 })) });
    const err = await catchErr(fetchKasiHolidays(2026, ctxWith(mock.fetch)));
    expect(err.kind).toBe("UPSTREAM");
    expect(err.detail?.reason).toBe("truncated");
  });

  it("non 8-digit locdate is UPSTREAM format", async () => {
    const mock = createKasiMock({
      2026: () => xmlRes(kasiXml([{ locdate: "2026-01-01", isHoliday: "Y", dateName: "1월1일" }])),
    });
    const err = await catchErr(fetchKasiHolidays(2026, ctxWith(mock.fetch)));
    expect(err.kind).toBe("UPSTREAM");
    expect(err.detail?.reason).toBe("format");
  });

  it("error messages never contain the key", async () => {
    const failures: ToolError[] = [];
    failures.push(await catchErr(fetchKasiHolidays(2026, ctxWith(createKasiMock({}).fetch, {}))));
    for (const code of ["20", "22", "30"]) {
      const mock = createKasiMock({ 2026: () => xmlRes(kasiXml([], { resultCode: code })) });
      failures.push(await catchErr(fetchKasiHolidays(2026, ctxWith(mock.fetch))));
    }
    failures.push(await catchErr(fetchKasiHolidays(2026, ctxWith(createKasiMock({ 2026: () => htmlRes200() }).fetch))));
    failures.push(await catchErr(fetchKasiHolidays(2026, ctxWith(createKasiMock({ 2026: () => emptyRes() }).fetch))));
    for (const err of failures) {
      const text = `${err.message}${JSON.stringify(err.detail ?? {})}`;
      for (const form of FORMS(K)) expect(text.includes(form)).toBe(false);
    }
  });

  it("spec stays provisional and module writes no files", () => {
    expect(SPECS.kasiHoliday.confirmed).toBe(false);
    const src = readFileSync(new URL("../src/clients/kasi-holidays.ts", import.meta.url), "utf8");
    expect(src.includes("node:fs")).toBe(false);
    expect(src.includes("writeFile")).toBe(false);
    expect(src.includes("process.")).toBe(false);
  });
});
