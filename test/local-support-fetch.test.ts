import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { callDataGoKr } from "../src/clients/data-go-kr.js";
import { SPECS } from "../src/clients/data-go-kr-specs.js";
import { CACHE_TTL_MS } from "../src/core/cache-ttl.js";
import { ToolError } from "../src/core/errors.js";
import {
  fetchLocalSupport,
  LCGV_ACTIONS,
  lifeFilter,
  type LocalSupportQuery,
} from "../src/local-support/fetch.js";
import { LCGV_APPLY_ACTION, toLcgvRow, type LcgvRow } from "../src/local-support/summarize.js";
import { welfareRegionFromText, type WelfareRegionParams } from "../src/region/welfare-names.js";
import { KEY_FORMS } from "./helpers/nemc-mock.js";
import {
  AMOUNT_TOKEN,
  createLcgvMock,
  defaultDetailRoute,
  hang,
  lcgvCtx,
  lcgvError,
  lcgvFx,
  lcgvItems,
  lcgvRes,
  sequence,
  SUWON_SYNTH,
  type LcgvCtx,
  type LcgvErrCode,
  type LcgvRoute,
} from "./helpers/lcgv-mock.js";

const HOUR = 3_600_000;

function region(text: string): WelfareRegionParams {
  const r = welfareRegionFromText(text);
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error(text);
  return r.params;
}

async function errOf(p: Promise<unknown>): Promise<ToolError> {
  const e = await p.then(
    () => {
      throw new Error("expected rejection");
    },
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(ToolError);
  return e as ToolError;
}

type Mode = "ok" | "hang" | LcgvErrCode;

function modeList(initial: Mode = "ok") {
  const state: { mode: Mode } = { mode: initial };
  const route: LcgvRoute = (u, init, n) => {
    if (state.mode === "ok") return lcgvRes("lcgvList/mapo.xml");
    if (state.mode === "hang") return hang(u, init, n);
    return lcgvError(state.mode);
  };
  return { state, route };
}

function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v instanceof Map) for (const x of v.values()) strings(x, out);
  else if (typeof v === "object" && v !== null) for (const x of Object.values(v)) strings(x, out);
  return out;
}

const mapoQuery: LocalSupportQuery = { region: region("서울 마포구"), stage: "pregnancy" };

describe("fetchLocalSupport", () => {
  beforeAll(() => {
    vi.stubGlobal("fetch", () => {
      throw new Error("global fetch disabled");
    });
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("budget: list 1 + details 3 = 4 fetches", async () => {
    const mock = createLcgvMock({ list: () => lcgvRes("lcgvList/mapo.xml") });
    const res = await fetchLocalSupport(mapoQuery, lcgvCtx(mock));
    expect(res.calls).toBe(4);
    expect(mock.count("list")).toBe(1);
    expect(mock.count("detail")).toBe(3);
    expect(res.details.size).toBe(3);
    expect(res.detailFailed).toBe(0);
    expect(res.rows).toHaveLength(12);
  });

  it("list retry leaves at most 2 details", async () => {
    const mock = createLcgvMock({
      list: sequence(() => lcgvError("99"), () => lcgvRes("lcgvList/haenam.xml")),
    });
    const res = await fetchLocalSupport(
      { region: region("전남광주통합특별시 해남군"), stage: "pregnancy" },
      lcgvCtx(mock),
    );
    expect(res.calls).toBe(4);
    expect(mock.count("list")).toBe(2);
    expect(mock.count("detail")).toBe(2);
    expect(res.rows).toHaveLength(3);
    expect(res.stale).toBeUndefined();
  });

  it("limit caps details", async () => {
    const mock = createLcgvMock({ list: () => lcgvRes("lcgvList/mapo.xml") });
    const res = await fetchLocalSupport({ ...mapoQuery, limit: 1 }, lcgvCtx(mock));
    expect(mock.count("detail")).toBe(1);
    expect(res.calls).toBe(2);
  });

  it("request params", async () => {
    const mockP = createLcgvMock({ list: () => lcgvRes("lcgvList/mapo.xml") });
    const resP = await fetchLocalSupport(mapoQuery, lcgvCtx(mockP));
    const up = mockP.lists().at(-1)!;
    expect(up.searchParams.get("lifeArray")).toBe("007");
    expect(up.searchParams.get("numOfRows")).toBe("100");
    expect(up.searchParams.get("pageNo")).toBe("1");
    expect(up.searchParams.get("ctpvNm")).toBe("서울특별시");
    expect(up.searchParams.get("sggNm")).toBe("마포구");
    expect(up.searchParams.has("searchWrd")).toBe(false);
    expect(resP.stageFilter).toBe("server");

    const mockA = createLcgvMock({ list: () => lcgvRes("lcgvList/mapo.xml") });
    const resA = await fetchLocalSupport({ ...mapoQuery, stage: "all" }, lcgvCtx(mockA));
    expect(mockA.lists().at(-1)!.searchParams.get("lifeArray")).toBe("007,001");
    expect(resA.stageFilter).toBe("server");

    const chulsan = lcgvItems("lcgvList/search-chulsan.xml");
    const expected = chulsan
      .filter((i) => String(i.lifeNmArray ?? "").replace(/\s+/g, "").includes("영유아"))
      .map(toLcgvRow)
      .filter((r): r is LcgvRow => r !== undefined);
    expect(expected).toHaveLength(2);
    const mockI = createLcgvMock({ list: () => lcgvRes("lcgvList/search-chulsan.xml") });
    const resI = await fetchLocalSupport({ ...mapoQuery, stage: "infant" }, lcgvCtx(mockI));
    expect(mockI.lists().at(-1)!.searchParams.has("lifeArray")).toBe(false);
    expect(resI.stageFilter).toBe("client");
    expect(resI.rows.map((r) => r.servId).sort()).toEqual(expected.map((r) => r.servId).sort());
    for (const r of resI.rows) {
      expect((r.lifeNames ?? "").replace(/\s+/g, "")).toContain("영유아");
    }

    const mockK = createLcgvMock({ list: () => lcgvRes("lcgvList/search-chulsan.xml") });
    await fetchLocalSupport({ ...mapoQuery, keyword: " 출산 " }, lcgvCtx(mockK));
    expect(mockK.lists().at(-1)!.searchParams.get("searchWrd")).toBe("출산");
    await fetchLocalSupport({ ...mapoQuery, keyword: "" }, lcgvCtx(mockK));
    expect(mockK.lists().at(-1)!.searchParams.has("searchWrd")).toBe(false);
  });

  it("constant flips", async () => {
    expect(lifeFilter("infant", { verified: true, multi: "007,001" })).toMatchObject({
      lifeArray: "001",
      stageFilter: "server",
    });
    const off = lifeFilter("all", { verified: false, multi: null });
    expect(off.stageFilter).toBe("client");
    expect(off.labels).toHaveLength(2);

    const mock = createLcgvMock({ list: () => lcgvRes("lcgvList/seoul-life007.xml") });
    const res = await fetchLocalSupport(
      { region: region("서울 마포구"), stage: "all" },
      lcgvCtx(mock),
      { life: { verified: false, multi: null } },
    );
    expect(mock.lists().at(-1)!.searchParams.has("lifeArray")).toBe(false);
    expect(res.stageFilter).toBe("client");
    expect(res.rows).toHaveLength(3);
    for (const r of res.rows) {
      expect((r.lifeNames ?? "").replace(/\s+/g, "")).toContain("임신·출산");
    }
  });

  it("current names in request urls (PAC41)", async () => {
    const mockH = createLcgvMock();
    await fetchLocalSupport({ region: region("전라남도 해남군"), stage: "pregnancy" }, lcgvCtx(mockH));
    const uh = mockH.lists().at(-1)!;
    expect(uh.searchParams.get("ctpvNm")).toBe("전남광주통합특별시");
    expect(uh.searchParams.get("sggNm")).toBe("해남군");

    const mockS = createLcgvMock();
    const resS = await fetchLocalSupport({ region: region("수원시 장안구"), stage: "pregnancy" }, lcgvCtx(mockS));
    const us = mockS.lists().at(-1)!;
    expect(us.searchParams.get("ctpvNm")).toBe("경기도");
    expect(us.searchParams.get("sggNm")).toBe("수원시");
    expect(resS.rows).toHaveLength(SUWON_SYNTH.length);

    const mockD = createLcgvMock({ list: () => lcgvError("40") });
    const resD = await fetchLocalSupport({ region: region("강원도"), stage: "pregnancy" }, lcgvCtx(mockD));
    const ud = mockD.lists().at(-1)!;
    expect(ud.searchParams.get("ctpvNm")).toBe("강원특별자치도");
    expect(ud.searchParams.has("sggNm")).toBe(false);
    expect(resD.rows).toEqual([]);
    expect(resD.total).toBe(0);
  });

  it("unknown region makes no call", () => {
    const r = welfareRegionFromText("없는시 없는구");
    expect(r.ok).toBe(false);
    const mock = createLcgvMock();
    expect(mock.count()).toBe(0);
  });

  it("ttl reuse", async () => {
    const mock = createLcgvMock({ list: () => lcgvRes("lcgvList/mapo.xml") });
    const ctx: LcgvCtx = lcgvCtx(mock);
    const first = await fetchLocalSupport(mapoQuery, ctx);
    expect(first.calls).toBe(4);

    const second = await fetchLocalSupport(mapoQuery, ctx);
    expect(second.calls).toBe(0);
    expect(second.rows).toEqual(first.rows);

    ctx.advance(12 * HOUR + 1);
    const third = await fetchLocalSupport(mapoQuery, ctx);
    expect(third.calls).toBe(1);

    ctx.advance(12 * HOUR);
    const fourth = await fetchLocalSupport(mapoQuery, ctx);
    expect(fourth.calls).toBe(4);
  });

  it("other spec cache entries untouched", async () => {
    const m = modeList();
    const mock = createLcgvMock({ list: m.route });
    const ctx = lcgvCtx(mock);
    const seed = "dgk:benefitsList?page=1";
    const now = ctx.clock.now().getTime();
    const seeded = { v: { items: [], totalCount: 0 } };
    ctx.cache.set(seed, seeded, 3_600_000, now);

    await fetchLocalSupport(mapoQuery, ctx);
    m.state.mode = "22";
    await errOf(fetchLocalSupport({ region: region("전남 해남군"), stage: "pregnancy" }, ctx));

    expect(await ctx.cache.get(seed, now)).toEqual(seeded);
    const others = ctx.cache.keys().filter((k) => k !== seed);
    expect(others.length).toBeGreaterThan(0);
    for (const k of others) {
      expect(/^(dgk:lcgvList\?|dgk:lcgvDetail\?|lcgv:last:)/.test(k)).toBe(true);
    }
    expect(CACHE_TTL_MS.localSupportList).toBe(12 * HOUR);
    expect(CACHE_TTL_MS.localSupportDetail).toBe(24 * HOUR);
  });

  it("22 and 23 have distinct actions", async () => {
    const mock22 = createLcgvMock({ list: () => lcgvError("22") });
    const e22 = await errOf(fetchLocalSupport(mapoQuery, lcgvCtx(mock22)));
    expect(e22.kind).toBe("DAILY_LIMIT");
    expect(e22.actions).toEqual([LCGV_ACTIONS.DAILY_LIMIT]);
    expect(mock22.count("list")).toBe(1);

    const mock23 = createLcgvMock({ list: () => lcgvError("23") });
    const e23 = await errOf(fetchLocalSupport(mapoQuery, lcgvCtx(mock23)));
    expect(e23.kind).toBe("RATE_LIMIT");
    expect(e23.actions).toEqual([LCGV_ACTIONS.RATE_LIMIT]);

    expect(LCGV_ACTIONS.DAILY_LIMIT).not.toBe(LCGV_ACTIONS.RATE_LIMIT);
  });

  it("22 and 23 fall back to the saved response", async () => {
    for (const code of ["22", "23"] as const) {
      const m = modeList();
      const mock = createLcgvMock({ list: m.route });
      const ctx = lcgvCtx(mock);
      await fetchLocalSupport(mapoQuery, ctx);
      ctx.advance(13 * HOUR);
      m.state.mode = code;
      const res = await fetchLocalSupport(mapoQuery, ctx);
      expect(res.stale).toEqual({ ageMs: 13 * HOUR });
      expect(res.rows).toHaveLength(12);
      expect(res.details.size).toBe(0);
      expect(res.calls).toBe(1);
    }

    const m = modeList();
    const mock = createLcgvMock({ list: m.route });
    const ctx = lcgvCtx(mock);
    await fetchLocalSupport(mapoQuery, ctx);
    ctx.advance(7 * 24 * HOUR);
    m.state.mode = "22";
    const e = await errOf(fetchLocalSupport(mapoQuery, ctx));
    expect(e.kind).toBe("DAILY_LIMIT");
  });

  it("99 and timeout retry", async () => {
    const m1 = modeList("99" as Mode);
    const mock1 = createLcgvMock({ list: m1.route });
    const e99 = await errOf(fetchLocalSupport(mapoQuery, lcgvCtx(mock1)));
    expect(e99.kind).toBe("UPSTREAM");
    expect(e99.detail?.code).toBe("99");
    expect(e99.actions).toEqual([LCGV_ACTIONS.SLOW]);
    expect(mock1.count("list")).toBe(2);

    const m2 = modeList();
    const mock2 = createLcgvMock({ list: m2.route });
    const ctx2 = lcgvCtx(mock2);
    await fetchLocalSupport(mapoQuery, ctx2);
    ctx2.advance(13 * HOUR);
    m2.state.mode = "99";
    const before2 = mock2.count("list");
    const stale = await fetchLocalSupport(mapoQuery, ctx2);
    expect(stale.stale).toBeDefined();
    expect(mock2.count("list") - before2).toBe(2);

    const mock3 = createLcgvMock({ list: sequence(hang, () => lcgvRes("lcgvList/haenam.xml")) });
    const ctx3 = lcgvCtx(mock3, { config: { httpTimeoutMs: 30, chainDeadlineMs: 5000 } });
    const ok3 = await fetchLocalSupport(
      { region: region("전남광주통합특별시 해남군"), stage: "pregnancy" },
      ctx3,
    );
    expect(ok3.rows).toHaveLength(3);
    expect(mock3.count("list")).toBe(2);

    const mock4 = createLcgvMock({ list: hang });
    const e4 = await errOf(fetchLocalSupport(mapoQuery, lcgvCtx(mock4, { config: { httpTimeoutMs: 30 } })));
    expect(e4.kind).toBe("TIMEOUT");
    expect(e4.actions).toEqual([LCGV_ACTIONS.SLOW]);
    expect(mock4.count("list")).toBe(2);

    let ctx5: LcgvCtx | undefined;
    const mock5 = createLcgvMock({
      list: () => {
        ctx5!.advance(2000);
        return lcgvError("99");
      },
    });
    ctx5 = lcgvCtx(mock5, { config: { chainDeadlineMs: 1000 } });
    const e5 = await errOf(fetchLocalSupport(mapoQuery, ctx5));
    expect(mock5.count("list")).toBe(1);
    expect(e5.kind).toBe("UPSTREAM");
    expect(e5.actions).toEqual([LCGV_ACTIONS.SLOW]);
  });

  it("code 12 is not retried", async () => {
    const mock = createLcgvMock({ list: () => lcgvError("12") });
    const e = await errOf(fetchLocalSupport(mapoQuery, lcgvCtx(mock)));
    expect(e.kind).toBe("UPSTREAM");
    expect(e.detail?.code).toBe("12");
    expect(mock.count("list")).toBe(1);
    expect(e.actions).not.toContain(LCGV_ACTIONS.SLOW);
  });

  it("key errors carry the apply action", async () => {
    const cases: [LcgvErrCode, "KEY_INVALID" | "NOT_APPROVED" | "KEY_EXPIRED"][] = [
      ["30", "KEY_INVALID"],
      ["20", "NOT_APPROVED"],
      ["31", "KEY_EXPIRED"],
    ];
    for (const [code, kind] of cases) {
      const lines: string[] = [];
      const mock = createLcgvMock({ list: () => lcgvError(code) });
      const e = await errOf(fetchLocalSupport(mapoQuery, lcgvCtx(mock, { sink: (l) => lines.push(l) })));
      expect(e.kind).toBe(kind);
      expect(e.actions).toContain(LCGV_APPLY_ACTION);
      expect(mock.count("list")).toBe(1);
      const text = JSON.stringify({ m: e.message, a: e.actions, d: e.detail }) + lines.join("\n");
      for (const k of KEY_FORMS) expect(text.includes(k)).toBe(false);
    }
  });

  it("missing key", async () => {
    const mock = createLcgvMock();
    const e = await errOf(fetchLocalSupport(mapoQuery, lcgvCtx(mock, { noKey: true })));
    expect(e.kind).toBe("MISSING_KEY");
    expect(mock.count()).toBe(0);
  });

  it("detail failures are counted", async () => {
    const mock = createLcgvMock({
      list: () => lcgvRes("lcgvList/mapo.xml"),
      detail: (u, init, n = 0) => (n === 0 ? lcgvError("99") : defaultDetailRoute(u)),
    });
    const res = await fetchLocalSupport(mapoQuery, lcgvCtx(mock));
    expect(res.detailFailed).toBe(1);
    expect(res.details.size).toBe(2);
    expect(res.rows).toHaveLength(12);
    expect(mock.count("detail")).toBe(3);

    const mockH = createLcgvMock({ list: () => lcgvRes("lcgvList/mapo.xml"), detail: hang });
    const resH = await fetchLocalSupport(mapoQuery, lcgvCtx(mockH, { config: { httpTimeoutMs: 30 } }));
    expect(resH.detailFailed).toBe(3);
    expect(resH.details.size).toBe(0);
    expect(resH.rows).toHaveLength(12);
  });

  it("sido common may be missing flag", async () => {
    const mock = createLcgvMock({ list: () => lcgvRes("lcgvList/mapo.xml") });
    const res = await fetchLocalSupport(mapoQuery, lcgvCtx(mock));
    expect(res.sidoCommonMayBeMissing).toBe(true);
    expect(res.calls).toBe(4);

    const mockS = createLcgvMock();
    const resS = await fetchLocalSupport({ region: region("서울특별시"), stage: "pregnancy" }, lcgvCtx(mockS));
    expect(resS.sidoCommonMayBeMissing).toBe(false);
  });

  it("result never invents amounts", async () => {
    const mock = createLcgvMock({
      list: () => lcgvRes("lcgvList/mapo.xml"),
      detail: () => lcgvRes("lcgvDetail/amount.xml"),
    });
    const res = await fetchLocalSupport(mapoQuery, lcgvCtx(mock));
    const source = lcgvFx("lcgvDetail/amount.xml") + lcgvFx("lcgvList/mapo.xml");
    const all = strings({ rows: res.rows, details: res.details });
    expect(all.length).toBeGreaterThan(0);
    for (const s of all) {
      for (const m of s.matchAll(AMOUNT_TOKEN)) {
        expect(source.includes(m[0])).toBe(true);
      }
    }
  });
});

describe("callDataGoKr retries option", () => {
  it("retries 0 issues one request", async () => {
    const fetchMock = vi.fn(async () => new Response("busy", { status: 503 }));
    const ctx = { ...lcgvCtx(createLcgvMock()), fetch: fetchMock as unknown as typeof fetch };
    await expect(callDataGoKr(SPECS.lcgvList, { ctpvNm: "서울특별시" }, ctx, { retries: 0 })).rejects.toMatchObject({
      kind: "UPSTREAM",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("default keeps one internal retry", async () => {
    const fetchMock = vi.fn(async () => new Response("busy", { status: 503 }));
    const ctx = { ...lcgvCtx(createLcgvMock()), fetch: fetchMock as unknown as typeof fetch };
    await expect(callDataGoKr(SPECS.lcgvList, { ctpvNm: "서울특별시" }, ctx)).rejects.toMatchObject({
      kind: "UPSTREAM",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
