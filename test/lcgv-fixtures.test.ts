import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { callDataGoKr } from "../src/clients/data-go-kr.js";
import { SPECS } from "../src/clients/data-go-kr-specs.js";
import { ToolError } from "../src/core/errors.js";
import { findLeaks, trimItems } from "../scripts/lib/sample-mask.js";
import { createTestContext } from "./helpers/context.js";

type Entry = {
  source: string;
  call?: number;
  status: number;
  code: string;
  totalCount?: number;
  items?: number;
  servId?: string;
  params?: Record<string, string>;
};

const manifest = JSON.parse(
  readFileSync(new URL("./fixtures/data-go-kr/lcgv-sources.json", import.meta.url), "utf8"),
) as { asOf: string; files: Record<string, Entry> };

const KIND: Record<string, string> = {
  "20": "NOT_APPROVED",
  "22": "DAILY_LIMIT",
  "23": "RATE_LIMIT",
  "30": "KEY_INVALID",
  "31": "KEY_EXPIRED",
  "99": "UPSTREAM",
  "12": "UPSTREAM",
};

const fx = (p: string) => readFileSync(new URL(`./fixtures/data-go-kr/${p}`, import.meta.url), "utf8");

const specFor = (p: string) => (p.startsWith("lcgvList/") ? SPECS.lcgvList : SPECS.lcgvDetail);

const ctxWith = (text: string, status = 200) => ({
  ...createTestContext({ env: { DATA_GO_KR_SERVICE_KEY: "test-key-0000" } }),
  fetch: (async () =>
    new Response(text, { status, headers: { "content-type": "application/xml; charset=utf-8" } })) as unknown as typeof fetch,
});

const errOf = (p: Promise<unknown>): Promise<ToolError> =>
  p.then(
    () => {
      throw new Error("resolved");
    },
    (e: unknown) => e as ToolError,
  );

const entriesWith = (folder: string, code: string) =>
  Object.entries(manifest.files).filter(([k, e]) => k.startsWith(`${folder}/`) && e.code === code);

const listOk = entriesWith("lcgvList", "0");
const detailOk = entriesWith("lcgvDetail", "0");
const errorEntries = Object.entries(manifest.files).filter(([, e]) => KIND[e.code] !== undefined);

describe("lcgv fixtures", () => {
  it("manifest covers every lcgv fixture", () => {
    const files = [
      ...readdirSync(new URL("./fixtures/data-go-kr/lcgvList", import.meta.url)).map((f) => `lcgvList/${f}`),
      ...readdirSync(new URL("./fixtures/data-go-kr/lcgvDetail", import.meta.url)).map((f) => `lcgvDetail/${f}`),
    ].sort();
    expect(files).toEqual(Object.keys(manifest.files).sort());
    for (const e of Object.values(manifest.files)) expect(e.source).toMatch(/^(실호출|합성)/);
    for (const folder of ["lcgvList", "lcgvDetail"]) {
      expect(
        Object.entries(manifest.files).some(([k, e]) => k.startsWith(`${folder}/`) && e.source.startsWith("실호출")),
      ).toBe(true);
    }
  });

  it.each(listOk)("code 0 list fixture %s parses items and totalCount", async (p, e) => {
    const r = await callDataGoKr(SPECS.lcgvList, e.params ?? {}, ctxWith(fx(p), e.status));
    expect(r.items.length).toBe(e.items);
    expect(r.totalCount).toBe(e.totalCount);
    for (const i of r.items) {
      expect(i.servId).toEqual(expect.any(String));
      expect(i.servId).not.toBe("");
      expect(i.servNm).toEqual(expect.any(String));
      expect(i.servNm).not.toBe("");
    }
  });

  it("code 40 is zero items", async () => {
    const es = entriesWith("lcgvList", "40");
    expect(es.length).toBeGreaterThan(0);
    for (const [p, e] of es) {
      const r = await callDataGoKr(SPECS.lcgvList, e.params ?? {}, ctxWith(fx(p), e.status));
      expect(r).toMatchObject({ items: [], totalCount: 0 });
    }
  });

  it.each(errorEntries)("error fixture %s keeps kind and code", async (p, e) => {
    const err = await errOf(callDataGoKr(specFor(p), e.params ?? {}, ctxWith(fx(p), e.status)));
    expect(err).toBeInstanceOf(ToolError);
    expect(err.kind).toBe(KIND[e.code]);
    expect(err.detail).toEqual({ code: e.code });
  });

  it("bad-key sample is present and live", () => {
    const e = manifest.files["lcgvList/error-bad-key.xml"];
    expect(e).toBeDefined();
    expect(e?.source).toBe("실호출");
    expect(e?.call).toBe(14);
  });

  it.each(detailOk)("code 0 detail fixture %s parses one record", async (p, e) => {
    const r = await callDataGoKr(SPECS.lcgvDetail, e.params ?? {}, ctxWith(fx(p), e.status));
    expect(r.items.length).toBe(1);
    expect(r.items[0]?.servId).toBe(e.servId);
    expect(r.totalCount).toBeUndefined();
  });

  it("single item and array responses", async () => {
    const one = trimItems(fx("lcgvList/mapo.xml"), "xml", 1, "servList").text;
    const single = await callDataGoKr(SPECS.lcgvList, {}, ctxWith(one, 200));
    expect(single.items.length).toBe(1);

    const many = await callDataGoKr(SPECS.lcgvList, {}, ctxWith(fx("lcgvList/mapo.xml"), 200));
    expect(many.items.length).toBe(manifest.files["lcgvList/mapo.xml"]?.items);
    expect(many.items.length).toBeGreaterThan(1);
  });

  it("omitted tags parse", async () => {
    const stripped = fx("lcgvList/mapo.xml")
      .replace(/<sggNm>[\s\S]*?<\/sggNm>/, "")
      .replace(/<intrsThemaNmArray>[\s\S]*?<\/intrsThemaNmArray>/, "");
    const r = await callDataGoKr(SPECS.lcgvList, {}, ctxWith(stripped, 200));
    expect(r.items[0]?.servId).toEqual(expect.any(String));
    expect("sggNm" in (r.items[0] ?? {})).toBe(false);

    const live = listOk.filter(([, e]) => e.source.startsWith("실호출"));
    const all: Record<string, unknown>[] = [];
    for (const [p, e] of live) {
      const r = await callDataGoKr(SPECS.lcgvList, e.params ?? {}, ctxWith(fx(p), e.status));
      all.push(...r.items);
    }
    expect(all.some((i) => !("intrsThemaNmArray" in i))).toBe(true);
  });

  it("lcgv fixtures hold no key-like values", () => {
    for (const p of Object.keys(manifest.files)) {
      const text = fx(p);
      expect(findLeaks(text, [], { heuristic: true }), p).toEqual([]);
      expect(text, p).not.toMatch(/serviceKey=(?!\*\*\*)/i);
    }
  });
});
