import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parseBody, pick } from "../src/clients/parse.js";
import { addDays, makeDate, type CivilDate } from "../src/date/civil-date.js";
import {
  compareLcgv,
  isStale,
  LCGV_APPLY_ACTION,
  LCGV_QUOTE_SUFFIX,
  quote,
  scopeOf,
  sidoCommonMayBeMissing,
  toLcgvDetail,
  toLcgvRow,
  type LcgvRow,
} from "../src/local-support/summarize.js";
import {
  AMOUNT_TOKEN,
  lcgvDetailItem,
  lcgvDetailXml,
  lcgvFx,
  lcgvItems,
  RATIO_TOKEN,
} from "./helpers/lcgv-mock.js";

const ymd = (s: string): CivilDate => {
  const [y, m, d] = s.split("-").map(Number);
  return makeDate(y!, m!, d!);
};

function row(servId: string, extra: Partial<LcgvRow> = {}): LcgvRow {
  return { servId, name: `항목 ${servId}`, ...extra };
}

describe("local support summarize", () => {
  beforeAll(() => {
    vi.stubGlobal("fetch", () => {
      throw new Error("global fetch disabled");
    });
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes mapo rows with omitted tags", () => {
    const rows = lcgvItems("lcgvList/mapo.xml")
      .map(toLcgvRow)
      .filter((r): r is LcgvRow => r !== undefined);
    expect(rows).toHaveLength(12);
    expect(rows.filter((r) => r.lifeNames === undefined)).toHaveLength(6);
    expect(rows.filter((r) => r.themes === undefined)).toHaveLength(3);
    expect(rows.filter((r) => r.applyMethod === undefined)).toHaveLength(3);
    for (const r of rows) {
      for (const v of Object.values(r)) {
        expect(v).not.toBe("");
      }
      expect(r.sgg).toBe("마포구");
      expect(r.lastMod).toBeDefined();
    }
  });

  it("rows without sigungu", () => {
    const rows = lcgvItems("lcgvList/seoul-life007.xml")
      .map(toLcgvRow)
      .filter((r): r is LcgvRow => r !== undefined);
    expect(rows).toHaveLength(3);
    const noSgg = rows.filter((r) => r.sgg === undefined);
    expect(noSgg).toHaveLength(1);
    const [only] = noSgg;
    expect(scopeOf(only!, { sggNm: "도봉구" })).toBe("시도 공통");
    expect(scopeOf(only!, {})).toBe("시군구");
  });

  it("haenam and search samples parse", () => {
    const haenam = lcgvItems("lcgvList/haenam.xml")
      .map(toLcgvRow)
      .filter((r): r is LcgvRow => r !== undefined);
    expect(haenam).toHaveLength(3);
    for (const r of haenam) expect(r.ctpv).toBe("전남광주통합특별시");
    const search = lcgvItems("lcgvList/search-chulsan.xml")
      .map(toLcgvRow)
      .filter((r): r is LcgvRow => r !== undefined);
    expect(search).toHaveLength(3);
  });

  it("servId or servNm missing is dropped", () => {
    expect(toLcgvRow({ servNm: "x" })).toBeUndefined();
    expect(toLcgvRow({ servId: "S1" })).toBeUndefined();
    expect(toLcgvRow({ servId: "  ", servNm: "x" })).toBeUndefined();
    expect(toLcgvRow({ servId: "S1", servNm: "x" })).toEqual({ servId: "S1", name: "x" });
  });

  it("single and array list responses give the same row", () => {
    const single = toLcgvRow(lcgvItems("lcgvList/mapo-life007.xml")[0]!);
    const same = lcgvItems("lcgvList/mapo.xml")
      .map(toLcgvRow)
      .find((r) => r?.servId === single?.servId);
    expect(same).toEqual(single);
  });

  it("detail single and array lists", () => {
    const d = toLcgvDetail(lcgvDetailItem("lcgvDetail/amount.xml"));
    expect(d.contacts).toHaveLength(1);
    expect(d.contacts[0]).toMatchObject({ value: "031-678-2247" });
    expect(d.laws).toEqual(["안성시 장애인가정 출산지원금 지원 조례"]);

    const xml = lcgvDetailXml({
      servId: "S",
      inqplCtadrList: [
        { wlfareInfoDtlCd: "010", wlfareInfoReldNm: "가", wlfareInfoReldCn: "02-000-0000" },
        { wlfareInfoDtlCd: "010", wlfareInfoReldNm: "나", wlfareInfoReldCn: "02-111-1111" },
      ],
      baslawList: [
        { wlfareInfoDtlCd: "030", wlfareInfoReldNm: "법1" },
        { wlfareInfoDtlCd: "030", wlfareInfoReldNm: "법2" },
      ],
    });
    const arr = toLcgvDetail(pick(parseBody(xml, "application/xml"), ["wantedDtl"]) as Record<string, unknown>);
    expect(arr.contacts).toEqual([
      { name: "가", value: "02-000-0000" },
      { name: "나", value: "02-111-1111" },
    ]);
    expect(arr.laws).toEqual(["법1", "법2"]);

    const none = toLcgvDetail({ servId: "S" });
    expect(none.contacts).toEqual([]);
    expect(none.laws).toEqual([]);
  });

  it("quote keeps the source prefix and amount tokens", () => {
    const raw = lcgvFx("lcgvDetail/amount.xml");
    const d = toLcgvDetail(lcgvDetailItem("lcgvDetail/amount.xml"));
    const fields = [d.target, d.criteria, d.content, d.applyText];
    for (const v of fields) {
      expect(v).toBeDefined();
      expect(quote(v)).toBe(v!.normalize("NFC").replace(/\s+/g, " ").trim());
    }
    const all = fields.map((v) => quote(v) ?? "").join("\n");
    const amounts = [...all.matchAll(AMOUNT_TOKEN)].map((m) => m[0]);
    expect(amounts).toEqual(["2백만원", "1백5십만원", "2백만원", "1백5십만원"]);
    for (const t of amounts) expect(raw.includes(t)).toBe(true);
    const ratios = [...all.matchAll(RATIO_TOKEN)].map((m) => m[0]);
    expect(ratios).toEqual(["100분의 50", "100분의 50"]);
  });

  it("quote truncates at 200 code points", () => {
    const src = "가".repeat(150) + "  지원금 1백5십만원\n" + "나".repeat(100);
    const out = quote(src)!;
    expect(out.startsWith(Array.from(src.replace(/\s+/g, " ")).slice(0, 200).join(""))).toBe(true);
    expect(out.endsWith("…(원문 일부)")).toBe(true);
    expect(LCGV_QUOTE_SUFFIX).toBe("…(원문 일부)");
    expect(Array.from(out).length).toBe(200 + Array.from(LCGV_QUOTE_SUFFIX).length);
    for (const m of out.matchAll(AMOUNT_TOKEN)) {
      expect(src.includes(m[0])).toBe(true);
    }
    expect(quote("가".repeat(200))).toBe("가".repeat(200));
    expect(quote("가")).toBe("가");
    expect(quote(undefined)).toBeUndefined();
    expect(quote("")).toBeUndefined();
    expect(quote("   ")).toBeUndefined();
    expect(quote("a  \n b")).toBe("a b");
  });

  it("isStale boundary", () => {
    const today = makeDate(2026, 11, 3);
    expect(isStale(addDays(today, -364), today)).toBe(false);
    expect(isStale(addDays(today, -365), today)).toBe(false);
    expect(isStale(addDays(today, -366), today)).toBe(true);
    expect(isStale(undefined, today)).toBeUndefined();
    expect(toLcgvRow({ servId: "S", servNm: "x", lastModYmd: "2026-07-03" })?.lastMod).toBeUndefined();
    expect(toLcgvRow({ servId: "S", servNm: "x", lastModYmd: "20261332" })?.lastMod).toBeUndefined();
    expect(isStale(toLcgvRow({ servId: "S", servNm: "x", lastModYmd: "20261332" })?.lastMod, today)).toBeUndefined();
  });

  it("compareLcgv order", () => {
    const rows: LcgvRow[] = [
      row("A2", { sgg: "마포구", lastMod: ymd("2026-07-10") }),
      row("C", { sgg: "마포구", lastMod: ymd("2026-07-10") }),
      row("B", { sgg: "마포구", lastMod: ymd("2026-07-01") }),
      row("Z", { sgg: "마포구" }),
      row("A", { lastMod: ymd("2026-10-01") }),
    ];
    const sorted = (q: { sggNm?: string }) => [...rows].sort(compareLcgv(q)).map((r) => r.servId);
    expect(sorted({ sggNm: "마포구" })).toEqual(["A2", "C", "B", "Z", "A"]);
    expect(sorted({})).toEqual(["A", "A2", "C", "B", "Z"]);
  });

  it("sido common may be missing", () => {
    const mapo = lcgvItems("lcgvList/mapo.xml")
      .map(toLcgvRow)
      .filter((r): r is LcgvRow => r !== undefined);
    const seoul = lcgvItems("lcgvList/seoul-life007.xml")
      .map(toLcgvRow)
      .filter((r): r is LcgvRow => r !== undefined);
    expect(sidoCommonMayBeMissing(mapo, { sggNm: "마포구" })).toBe(true);
    expect(sidoCommonMayBeMissing(seoul, { sggNm: "도봉구" })).toBe(false);
    expect(sidoCommonMayBeMissing(mapo, {})).toBe(false);
    expect(sidoCommonMayBeMissing(mapo, { sggNm: "마포구" }, true)).toBe(false);
  });

  it("apply action text", () => {
    expect(LCGV_APPLY_ACTION).toContain("15108347");
    expect(LCGV_APPLY_ACTION).toContain("DATA_GO_KR_SERVICE_KEY");
  });
});
