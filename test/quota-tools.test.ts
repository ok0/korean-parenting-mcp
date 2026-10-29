import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { TtlCache } from "../src/core/cache.js";
import { ToolError } from "../src/core/errors.js";
import { runTool } from "../src/core/pipeline.js";
import {
  createUpstreamGuard,
  defaultQuotaConfig,
  staleNotice,
  type QuotaEvent,
  type UpstreamGuard,
} from "../src/core/upstream-guard.js";
import { checkPregnancyDrugTool } from "../src/tools/check-pregnancy-drug.js";
import { findBenefitsTool } from "../src/tools/find-benefits.js";
import { findNightPediatricTool } from "../src/tools/find-night-pediatric.js";
import { getTimelineTool } from "../src/tools/get-timeline.js";
import { createDgkMock, gatewayXml } from "./helpers/dgk-mock.js";
import { xmlRes } from "./helpers/kasi-mock.js";
import { createNemcMock, nemcCtx } from "./helpers/nemc-mock.js";

const MOON_OK = readFileSync(new URL("./fixtures/data-go-kr/nemcMoonlight/seongdong.xml", import.meta.url), "utf8");
const PEDS_OK = readFileSync(new URL("./fixtures/data-go-kr/nemcList/ped-code.xml", import.meta.url), "utf8");
const MIN = 60_000;
const T0 = Date.parse("2026-10-28T21:30:00+09:00");
const MOON_URL = "https://apis.data.go.kr/B552657/HsptlAsembySearchService/getBabyListInfoInqire";
const PEDS_URL = "https://apis.data.go.kr/B552657/HsptlAsembySearchService/getHsptlMdcncListInfoInqire";

type ToolDefArg = Parameters<typeof runTool>[0];

const textOf = (res: { content: { type: "text"; text: string }[] }): string => res.content[0]!.text;
const bodyOf = (text: string): string => text.split("\n---")[0] ?? "";

let nowMs = T0;
let mode: "ok" | "22" | "30" = "ok";
let events: QuotaEvent[] = [];
let guard: UpstreamGuard;
let cache: TtlCache;
let mock: ReturnType<typeof createNemcMock>;
let dgk: ReturnType<typeof createDgkMock>;
let ctx: ReturnType<typeof nemcCtx>;

const nemcBody = (ok: string) => xmlRes(mode === "ok" ? ok : gatewayXml(mode));

const combinedFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const path = new URL(href).pathname;
  if (path.endsWith("/serviceList") || path.endsWith("/getPwnmTabooInfoList03")) return dgk.fetch(input, init);
  return mock.fetch(input, init);
}) as typeof fetch;

const run = (def: ToolDefArg, args: Record<string, unknown>) => runTool(def, args, ctx);

beforeEach(() => {
  nowMs = T0;
  mode = "ok";
  events = [];
  const clock = { now: () => new Date(nowMs) };
  guard = createUpstreamGuard({ ...defaultQuotaConfig(), onEvent: (e) => events.push(e) });
  cache = new TtlCache(500, 86_400_000);
  mock = createNemcMock({ moon: () => nemcBody(MOON_OK), peds: () => nemcBody(PEDS_OK) });
  dgk = createDgkMock();
  ctx = { ...nemcCtx(mock), fetch: combinedFetch, clock, cache, upstream: guard, notices: [] };
});

describe("quota tool scenarios", () => {
  it("AC2: 10 calls within 30 min fetch each NEMC op once", async () => {
    for (let i = 0; i < 10; i += 1) {
      nowMs = T0 + i * MIN;
      expect((await run(findNightPediatricTool, { region: "성동구" })).isError).toBeFalsy();
    }
    expect(mock.count("moon")).toBe(1);
    expect(mock.count("peds")).toBe(1);

    nowMs = T0 + 30 * MIN + 1;
    expect((await run(findNightPediatricTool, { region: "성동구" })).isError).toBeFalsy();
    expect(mock.count("moon")).toBe(2);
    expect(mock.count("peds")).toBe(2);

    const counts = await guard.counts(nowMs);
    expect(counts.nemcList).toBe(2);
    expect(counts.nemcMoonlight).toBe(2);
    expect(counts.kasi).toBeLessThanOrEqual(2);
    expect(counts.benefits + counts.dur + counts.law + counts.kindergarten + counts.safetykorea).toBe(0);
  });

  it("AC2: exhausted nemcList does not block nemcMoonlight", async () => {
    const cfg = defaultQuotaConfig();
    cfg.budgets.nemcList = 1;
    const g = createUpstreamGuard(cfg);
    await g.admit(new URL(PEDS_URL), nowMs);
    const err = await g.admit(new URL(PEDS_URL), nowMs).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ToolError);
    expect((err as ToolError).kind).toBe("DAILY_LIMIT");
    await g.admit(new URL(MOON_URL), nowMs);
    const counts = await g.counts(nowMs);
    expect(counts.nemcMoonlight).toBe(1);
  });

  it("AC3: 22 after TTL → stale with notice; uncached → retry error; others work; next day unblocks", async () => {
    const fixedNow = "2026-10-28T21:30:00+09:00";
    const first = textOf(await run(findNightPediatricTool, { region: "성동구", now: fixedNow }));

    nowMs = T0 + 31 * MIN;
    mode = "22";
    const stale = await run(findNightPediatricTool, { region: "성동구", now: fixedNow });
    expect(stale.isError).toBeFalsy();
    const staleText = textOf(stale);
    expect(staleText).toContain("약 31분 전에 저장된 정보");
    expect(staleText.split("\n").at(-1)).toBe(staleNotice(31 * MIN));
    expect(bodyOf(staleText)).toBe(bodyOf(first));

    const moonBefore = mock.count("moon");
    const pedsBefore = mock.count("peds");
    const uncached = await run(findNightPediatricTool, { region: "강남구" });
    expect(uncached.isError).toBe(true);
    expect(textOf(uncached)).toContain("잠시 후 재시도");
    expect(mock.count("moon")).toBe(moonBefore);
    expect(mock.count("peds")).toBe(pedsBefore);

    expect((await run(findBenefitsTool, { limit: "2" })).isError).toBeFalsy();
    expect((await run(checkPregnancyDrugTool, { drug_name: "아세트아미노펜" })).isError).toBeFalsy();
    expect((await run(getTimelineTool, { birth_date: "2025-03-17" })).isError).toBeFalsy();

    nowMs = Date.parse("2026-10-29T09:00:00+09:00");
    mode = "ok";
    const movedMoon = mock.count("moon");
    const movedPeds = mock.count("peds");
    expect((await run(findNightPediatricTool, { region: "강남구" })).isError).toBeFalsy();
    expect(mock.count("moon")).toBeGreaterThan(movedMoon);
    expect(mock.count("peds")).toBeGreaterThan(movedPeds);
  });

  it("stale beyond max not used", async () => {
    await run(findNightPediatricTool, { region: "성동구" });
    nowMs = T0 + 25 * 60 * MIN;
    mode = "22";
    expect((await run(findNightPediatricTool, { region: "성동구" })).isError).toBe(true);
  });

  it("KEY_INVALID never replaced by stale", async () => {
    await run(findNightPediatricTool, { region: "성동구" });
    nowMs = T0 + 31 * MIN;
    mode = "30";
    const res = await run(findNightPediatricTool, { region: "성동구" });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("KEY_INVALID");
  });

  it("AC8 parity without hooks", async () => {
    const plain = await runTool(findNightPediatricTool, { region: "성동구" }, nemcCtx(createNemcMock()));
    const guarded = await runTool(
      findNightPediatricTool,
      { region: "성동구" },
      {
        ...nemcCtx(createNemcMock()),
        cache: new TtlCache(500, 86_400_000),
        upstream: createUpstreamGuard(defaultQuotaConfig()),
        notices: [],
      },
    );
    expect(guarded.content).toEqual(plain.content);
  });
});
