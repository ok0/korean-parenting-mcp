import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../src/core/context.js";
import { loadData } from "../src/data-store/load.js";
import {
  HEALTH_CENTER_BASIS_ID,
  type HealthCenterEntry,
} from "../src/data-store/schema.js";
import {
  HEALTH_CENTER_PREPARING,
  HEALTH_CENTER_UNRESOLVED_LINKS,
  LOCAL_SUPPORT_FRESHNESS,
  LOCAL_SUPPORT_NOTICE,
  LOCAL_SUPPORT_STALE_MARK,
} from "../src/core/notice.js";
import {
  healthCenterLine,
  HEALTH_CENTER_SIDO_ONLY,
  lookupHealthCenterByRegion,
  type HealthCenterLookup,
} from "../src/region/health-centers.js";
import { normalizeRegion, type Region } from "../src/region/normalize.js";
import { welfareRegionParams } from "../src/region/welfare-names.js";
import { createServer } from "../src/server/create-server.js";
import { allTools } from "../src/tools/registry.js";
import {
  CLIENT_FILTER_NOTE,
  detailOnlyNote,
  findLocalSupportTool,
  healthCenterSection,
  LCGV_SERVICE_ERROR,
  NARROW_HINT,
  scopeLabel,
  SIDO_COMMON_HINT,
  ZERO_SUGGESTIONS,
} from "../src/tools/find-local-support.js";
import { NOTICE_SOURCE } from "../src/tools/shared/format.js";
import { LCGV_APPLY_ACTION, LCGV_QUOTE_SUFFIX, quote, toLcgvDetail, toLcgvRow } from "../src/local-support/summarize.js";
import { checkToolMeta } from "./helpers/meta-check.js";
import { OFFICIAL_CLAIM_META } from "./helpers/wording.js";
import { LOCAL_ASSERTIVE, NEGATIVE_STEM, UNOFFICIAL_KO } from "./helpers/affiliation-wording.js";
import { KEY_FORMS } from "./helpers/nemc-mock.js";
import {
  AMOUNT_TOKEN,
  createLcgvMock,
  defaultDetailRoute,
  hang,
  lcgvCtx,
  lcgvDetailItem,
  lcgvError,
  lcgvFx,
  lcgvItems,
  lcgvListXml,
  lcgvRes,
  sequence,
  SUWON_SYNTH,
  type LcgvErrCode,
  type LcgvMock,
} from "./helpers/lcgv-mock.js";
import { xmlRes } from "./helpers/kasi-mock.js";

const HOUR = 3_600_000;
const MAPO = "서울 마포구";
const BLOCK_HEADER = /^- .+ \[(시군구|시도 공통)\]$/;
const DETAIL_LABELS = ["  지원 대상(원문): ", "  지원 내용(원문): ", "  선정 기준(원문): ", "  신청 방법(원문): ", "  근거 법령: "];

beforeAll(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error("global fetch disabled");
  });
});

async function open(ctx: ToolContext) {
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const server = createServer(ctx, [findLocalSupportTool]);
  await server.connect(st);
  const client = new Client({ name: "t", version: "0" });
  await client.connect(ct);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

async function call(ctx: ToolContext, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
  const { client, close } = await open(ctx);
  try {
    const r = await client.callTool({ name: "find_local_support", arguments: args });
    const content = r.content as { type: string; text: string }[];
    return { text: content[0]!.text, isError: r.isError === true };
  } finally {
    await close();
  }
}

interface Run {
  text: string;
  isError: boolean;
  mock: LcgvMock;
  logs: string[];
}

async function run(args: Record<string, unknown>, mock: LcgvMock, opts?: Parameters<typeof lcgvCtx>[1]): Promise<Run> {
  const logs: string[] = [];
  const ctx = lcgvCtx(mock, { ...opts, sink: (line) => logs.push(line) });
  const r = await call(ctx, args);
  return { ...r, mock, logs };
}

function detailItemFor(id: string): Record<string, unknown> {
  if (id === "WLF00003366") return lcgvDetailItem("lcgvDetail/amount.xml");
  if (id === "WLF00004358") return lcgvDetailItem("lcgvDetail/mapo-life007.xml");
  return { servId: id, servNm: `합성 상세 ${id}`, sprtTrgtCn: "합성 지원 대상", lastModYmd: "20261001" };
}

function detailItemsOf(mock: LcgvMock): Record<string, unknown>[] {
  return mock.details().map((u) => detailItemFor(u.searchParams.get("servId") ?? ""));
}

function verbatims(
  listItems: Record<string, unknown>[],
  detailItems: Record<string, unknown>[],
  hc?: HealthCenterLookup,
): string[] {
  const out: (string | undefined)[] = [];
  for (const item of listItems) {
    const r = toLcgvRow(item);
    if (r === undefined) continue;
    out.push(r.name, r.dept, r.cycle, r.provision, r.applyMethod, r.sgg, r.link, quote(r.digest));
  }
  for (const item of detailItems) {
    const d = toLcgvDetail(item);
    out.push(quote(d.target), quote(d.content), quote(d.criteria), quote(d.applyText));
    for (const c of d.contacts) {
      out.push(c.name);
      if (c.value !== undefined) out.push(c.value, `${c.name} ${c.value}`);
    }
    out.push(...d.laws);
  }
  if (hc !== undefined && hc.kind === "found") {
    for (const c of hc.centers) out.push(healthCenterLine(c));
  }
  return out.filter((x): x is string => x !== undefined && x !== "");
}

function ownText(text: string, vs: readonly string[]): string {
  let out = text;
  const sorted = [...vs].filter((v) => v !== "").sort((a, b) => b.length - a.length);
  for (const v of sorted) out = out.split(v).join("");
  return out;
}

function keySafe(texts: readonly string[], lines: readonly string[]): boolean {
  const all = [...texts, ...lines];
  return KEY_FORMS.every((k) => !all.some((s) => s.includes(k)));
}

function blockOf(text: string, head: string): string {
  const lines = text.split("\n");
  const i = lines.findIndex((l) => l.startsWith(head));
  if (i < 0) return "";
  const rest = lines.slice(i);
  const end = rest.findIndex((l) => l === "");
  return (end < 0 ? rest : rest.slice(0, end)).join("\n");
}

function regionOf(text: string): Region {
  const r = normalizeRegion(text);
  if (!r.ok) throw new Error(`region not normalized: ${text}`);
  return r.region;
}

function foundRegion(): { text: string; region: Region } | undefined {
  const regions = loadData("regions");
  for (const c of loadData("health-centers").centers) {
    const sgg = regions.sigungu.find((g) => g.code === c.code);
    if (sgg === undefined) continue;
    const sido = regions.sido.find((s) => s.code === sgg.sido_code);
    if (sido === undefined) continue;
    const text = `${sido.name} ${sgg.name}`;
    const r = normalizeRegion(text);
    if (!r.ok) continue;
    if (lookupHealthCenterByRegion(r.region).kind !== "found") continue;
    if (!welfareRegionParams(r.region).ok) continue;
    return { text, region: r.region };
  }
  return undefined;
}

function expectFooter(text: string, region: Region): void {
  expect(text).toContain("[확인처]");
  expect(text).toContain("- 소관 부서·문의처:");
  expect(text).toContain("https://www.bokjiro.go.kr");
  expect(text).toContain("- 보건소");
  expect(text).toContain("https://www.gov.kr");
  expect(text).toContain(NOTICE_SOURCE);
  expect(text).toContain(healthCenterSection(lookupHealthCenterByRegion(region)));
}

const SYN_DATE_ROWS: Record<string, string>[] = [
  { servId: "SYN0000301", servNm: "합성 날짜 A", ctpvNm: "서울특별시", sggNm: "마포구", lastModYmd: "20251103" },
  { servId: "SYN0000302", servNm: "합성 날짜 B", ctpvNm: "서울특별시", sggNm: "마포구", lastModYmd: "20251102" },
  { servId: "SYN0000303", servNm: "합성 날짜 없음", ctpvNm: "서울특별시", sggNm: "마포구" },
];

const SYN_NO_TAG_ROWS: Record<string, string>[] = [
  { servId: "SYN0000101", servNm: "합성 태그 없음" },
  { servId: "SYN0000102", servNm: "합성 시도 행", ctpvNm: "서울특별시", lastModYmd: "20261001" },
];

describe("find_local_support", () => {
  it("AC1 meta and registration", async () => {
    expect(checkToolMeta(findLocalSupportTool, allTools.map((t) => t.name))).toEqual([]);
    expect(allTools).toHaveLength(11);
    expect(allTools.map((t) => t.name)).toContain("find_local_support");
    expect(allTools[allTools.length - 1]).toBe(findLocalSupportTool);

    const { client, close } = await open(lcgvCtx(createLcgvMock()));
    try {
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(1);
      const t = tools[0]!;
      expect(t.title).toBe(findLocalSupportTool.title);
      expect(t.description).toContain("참고용");
      expect(t.description).toContain("15108347");
      const props = (t.inputSchema as { properties: Record<string, { description?: string }> }).properties;
      for (const k of ["region", "stage", "keyword", "limit"]) {
        expect(props[k]!.description).toContain("예:");
      }
      expect(t.annotations).toEqual({ readOnlyHint: true, idempotentHint: true, openWorldHint: true });
      const meta = `${t.title}\n${t.description}`;
      expect(OFFICIAL_CLAIM_META.some((re) => re.test(meta))).toBe(false);
      expect(/비공식|unofficial|무관/i.test(meta)).toBe(false);
    } finally {
      await close();
    }
  });

  it("M62 registry server: no key, zero calls", async () => {
    const mock = createLcgvMock();
    const ctx = lcgvCtx(mock, { noKey: true });
    const server = createServer(ctx);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const client = new Client({ name: "t", version: "0" });
    await client.connect(ct);
    try {
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(11);
      expect(tools.map((t) => t.name)).toContain("find_local_support");
      const r = await client.callTool({ name: "find_local_support", arguments: { region: MAPO } });
      const content = r.content as { type: string; text: string }[];
      expect(r.isError).toBe(true);
      expect(content[0]!.text).toContain("DATA_GO_KR_SERVICE_KEY");
      expect(content[0]!.text).toContain("15108347");
      expect(content[0]!.text).toContain(LCGV_APPLY_ACTION);
      expect(mock.count()).toBe(0);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("AC2 region failures make no call", async () => {
    for (const region of ["인천 서구", "중구", "가나다라시"]) {
      const mock = createLcgvMock();
      const r = await run({ region }, mock);
      expect(r.isError).toBe(false);
      expect(r.text.startsWith("지역을 확인해 주세요:")).toBe(true);
      expect(mock.count()).toBe(0);
    }
  });

  it("AC3 normal 마포구 result", async () => {
    const mock = createLcgvMock({ list: () => lcgvRes("lcgvList/mapo.xml") });
    const r = await run({ region: MAPO }, mock);
    expect(r.isError).toBe(false);
    const lines = r.text.split("\n");
    expect(lines[0]).toMatch(/^지역 육아 지원 서비스\(참고용\): .+ · 임신·출산·영유아 · 전체 12건 중 5건$/);
    expect(lines[1]).toBe(LOCAL_SUPPORT_NOTICE);
    const headers = lines.filter((l) => BLOCK_HEADER.test(l));
    expect(headers).toHaveLength(5);
    for (const h of headers) expect(h).toContain("[시군구]");
    expect(r.text).toContain('요약(원문): "');
    expect(r.text).toContain("복지로 상세: https://www.bokjiro.go.kr");
    expect(r.text).toContain(detailOnlyNote(3));
    expect(r.text).toContain(LOCAL_SUPPORT_FRESHNESS);

    const at = lines.flatMap((l, i) => (BLOCK_HEADER.test(l) ? [i] : []));
    const block = (i: number): string => lines.slice(at[i], at[i + 1] ?? lines.length).join("\n");
    expect([0, 1, 2].some((i) => DETAIL_LABELS.some((label) => block(i).includes(label)))).toBe(true);
    for (const i of [3, 4]) {
      for (const label of DETAIL_LABELS) expect(block(i)).not.toContain(label);
    }
    expect(mock.details()).toHaveLength(3);
    expect(mock.count()).toBeLessThanOrEqual(4);
  });

  it("AC3 missing tags and no sgg", async () => {
    const mock = createLcgvMock({ list: () => xmlRes(lcgvListXml(SYN_NO_TAG_ROWS)) });
    const r = await run({ region: MAPO }, mock);
    expect(r.isError).toBe(false);
    expect(r.text).not.toContain("undefined");
    expect(r.text).not.toContain("·  ·");
    expect(r.text.split("\n").every((l) => !l.endsWith("·"))).toBe(true);
    const tagless = blockOf(r.text, "- 합성 태그 없음");
    expect(tagless).toContain("  수정일 없음");
    expect(tagless).not.toContain("요약(원문)");
    expect(tagless).not.toContain("복지로 상세");
    expect(r.text).toContain("- 합성 시도 행 [시도 공통]");
    expect(mock.count()).toBeLessThanOrEqual(4);
  });

  it("AC4 sido-only scope", async () => {
    const mock = createLcgvMock();
    const r = await run({ region: "서울특별시", stage: "pregnancy" }, mock);
    expect(r.isError).toBe(false);
    expect(r.text).toContain("[도봉구]");
    expect(r.text).toContain("[은평구]");
    expect(r.text).toContain("[시도 공통]");
    expect(r.text).not.toContain("[시군구]");
    expect(r.text).not.toContain(SIDO_COMMON_HINT);
    expect(mock.count()).toBeLessThanOrEqual(4);

    expect(scopeLabel({ sgg: "해남군" }, undefined)).toBe("해남군");
    expect(scopeLabel({}, undefined)).toBe("시도 공통");
    expect(scopeLabel({}, "마포구")).toBe("시도 공통");
    expect(scopeLabel({ sgg: "마포구" }, "마포구")).toBe("시군구");
  });

  it("AC4 sigungu query without sido-common rows shows the hint once", async () => {
    const mock = createLcgvMock({ list: () => lcgvRes("lcgvList/mapo.xml") });
    const r = await run({ region: MAPO }, mock);
    expect(r.text.split(SIDO_COMMON_HINT).length - 1).toBe(1);
    expect(mock.count("list")).toBe(1);
    expect(mock.count()).toBeLessThanOrEqual(4);
  });

  it("AC5 amounts are quoted only", async () => {
    const chulsan = createLcgvMock();
    const a = await run({ region: "경기 안성시", keyword: "출산" }, chulsan);
    expect(a.isError).toBe(false);
    const rawChulsan = lcgvFx("lcgvList/search-chulsan.xml") + lcgvFx("lcgvDetail/amount.xml");
    for (const m of a.text.match(AMOUNT_TOKEN) ?? []) expect(rawChulsan).toContain(m);
    const ownA = ownText(a.text, verbatims(lcgvItems("lcgvList/search-chulsan.xml"), detailItemsOf(chulsan)));
    expect(ownA.match(AMOUNT_TOKEN) ?? []).toEqual([]);
    expect(LOCAL_ASSERTIVE.test(ownA)).toBe(false);
    expect(chulsan.count()).toBeLessThanOrEqual(4);

    const mapo = createLcgvMock({ list: () => lcgvRes("lcgvList/mapo.xml") });
    const m = await run({ region: MAPO }, mapo);
    const rawMapo = [lcgvFx("lcgvList/mapo.xml"), lcgvFx("lcgvDetail/amount.xml"), lcgvFx("lcgvDetail/mapo-life007.xml")].join("");
    for (const amount of m.text.match(AMOUNT_TOKEN) ?? []) expect(rawMapo).toContain(amount);

    const long = await run(
      { region: MAPO },
      createLcgvMock({
        list: () =>
          xmlRes(
            lcgvListXml([
              { servId: "SYN0000401", servNm: "합성 긴 요약", ctpvNm: "서울특별시", sggNm: "마포구", servDgst: "가".repeat(250), lastModYmd: "20261001" },
            ]),
          ),
      }),
    );
    expect(long.text).toContain(LCGV_QUOTE_SUFFIX);
  });

  it("AC6 dates and stale mark", async () => {
    const mock = createLcgvMock({ list: () => xmlRes(lcgvListXml(SYN_DATE_ROWS)) });
    const r = await run({ region: MAPO }, mock);
    expect(r.isError).toBe(false);
    expect(r.text.split(LOCAL_SUPPORT_STALE_MARK).length - 1).toBe(1);
    expect(blockOf(r.text, "- 합성 날짜 B")).toContain(LOCAL_SUPPORT_STALE_MARK);
    expect(blockOf(r.text, "- 합성 날짜 A")).not.toContain(LOCAL_SUPPORT_STALE_MARK);
    expect(blockOf(r.text, "- 합성 날짜 없음")).toContain("  수정일 없음");
    expect(blockOf(r.text, "- 합성 날짜 없음")).not.toContain(LOCAL_SUPPORT_STALE_MARK);
    const lines = r.text.split("\n");
    const headers = lines.filter((l) => BLOCK_HEADER.test(l));
    const modLines = lines.filter((l) => /^  수정일 (\d{4}-\d{2}-\d{2}|없음)/.test(l));
    expect(headers).toHaveLength(3);
    expect(modLines).toHaveLength(headers.length);
    expect(r.text).toContain(LOCAL_SUPPORT_FRESHNESS);
  });

  it("AC7 large response is budgeted", async () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({
      servId: `SYN${String(i).padStart(7, "0")}`,
      servNm: `합성 항목 ${i}`,
      ctpvNm: "서울특별시",
      sggNm: "마포구",
      bizChrDeptNm: "합성 부서",
      servDgst: "가".repeat(250),
      lastModYmd: "20261001",
      servDtlLink: "https://www.bokjiro.go.kr/ssis-tbu/synth",
    }));
    const mock = createLcgvMock({ list: () => xmlRes(lcgvListXml(rows, 100)) });
    const r = await run({ region: MAPO, limit: 10 }, mock, { config: { maxResponseChars: 2000 } });
    expect(r.isError).toBe(false);
    expect(r.text.length).toBeLessThanOrEqual(2000);
    expect(r.text).toContain("전체 100건 중");
    expect(r.text).toContain(NARROW_HINT);
    expect(r.text).toContain("길이 제한으로");
    expect(r.text).toContain("[확인처]");
    expect(r.text).toContain(NOTICE_SOURCE);
    expect(r.text).toContain(LOCAL_SUPPORT_FRESHNESS);
    expect(r.text).not.toContain("자 생략");
  });

  it("AC7 infant client filter", async () => {
    const mock = createLcgvMock();
    const r = await run({ region: MAPO, stage: "infant" }, mock);
    expect(r.isError).toBe(false);
    expect(r.text).toContain(CLIENT_FILTER_NOTE);
    expect(mock.lists()[0]!.searchParams.has("lifeArray")).toBe(false);
    expect(mock.count()).toBeLessThanOrEqual(4);
  });

  it("AC7 detail partial failure", async () => {
    let d = 0;
    const mock = createLcgvMock({
      list: () => lcgvRes("lcgvList/mapo.xml"),
      detail: (u) => {
        d += 1;
        return d === 1 ? lcgvError("12") : defaultDetailRoute(u);
      },
    });
    const r = await run({ region: MAPO }, mock);
    expect(r.isError).toBe(false);
    expect(r.text).toContain("일부 결과만 표시합니다");
    expect(mock.count()).toBeLessThanOrEqual(4);
  });

  it("AC8 confirm footer and health center section", async () => {
    const mapo = await run({ region: MAPO }, createLcgvMock({ list: () => lcgvRes("lcgvList/mapo.xml") }));
    expectFooter(mapo.text, regionOf(MAPO));

    const found = foundRegion();
    expect(found).toBeDefined();
    const f = found!;
    const fr = await run({ region: f.text }, createLcgvMock({ list: () => xmlRes(lcgvListXml(SUWON_SYNTH)) }));
    const lookup = lookupHealthCenterByRegion(f.region);
    if (lookup.kind !== "found") throw new Error("expected found region");
    expect(fr.text).toContain(`목록 기준일 ${loadData("health-centers").as_of}`);
    expect(fr.text).toContain(healthCenterLine(lookup.centers[0]!));

    const sido = await run({ region: "서울특별시", stage: "pregnancy" }, createLcgvMock());
    expect(sido.text).toContain(HEALTH_CENTER_SIDO_ONLY);
    expect(sido.text).toContain(HEALTH_CENTER_UNRESOLVED_LINKS);
  });

  it("AC8 health center section unit cases", () => {
    const c = (name: string): HealthCenterEntry => ({ code: "11440", name, kind: "보건소", verified: "partial" });
    const found: HealthCenterLookup = {
      kind: "found",
      label: "합성 지역",
      centers: [c("합성 보건소 1"), c("합성 보건소 2"), c("합성 보건소 3")],
      scope: "sigungu",
      asOf: "2026-01-01",
      basisId: HEALTH_CENTER_BASIS_ID,
    };
    const fs = healthCenterSection(found);
    expect(fs).toContain("합성 보건소 1 / 합성 보건소 2 / 합성 보건소 3");
    expect(fs).toContain("목록 기준일 2026-01-01");

    const none = healthCenterSection({ kind: "unresolved", reason: "none", message: HEALTH_CENTER_PREPARING, candidates: [] });
    expect(none).toContain(HEALTH_CENTER_PREPARING);
    expect(none).toContain(HEALTH_CENTER_UNRESOLVED_LINKS);

    const multiple = healthCenterSection({
      kind: "unresolved",
      reason: "multiple",
      message: "합성 안내",
      candidates: ["합성구 A", "합성구 B"],
    });
    expect(multiple).toContain("후보: 합성구 A, 합성구 B");
    expect(multiple).toContain(HEALTH_CENTER_UNRESOLVED_LINKS);
  });

  it("AC9 zero results", async () => {
    const a = await run({ region: MAPO }, createLcgvMock({ list: () => lcgvError("40") }));
    expect(a.isError).toBe(false);
    expect(a.text).toContain("지역 지원 서비스 조회 결과가 없습니다");
    for (const s of ZERO_SUGGESTIONS) expect(a.text).toContain(s);
    expectFooter(a.text, regionOf(MAPO));
    expect(a.text).toContain(LOCAL_SUPPORT_FRESHNESS);
    expect(a.mock.count()).toBeLessThanOrEqual(4);

    const rows: Record<string, string>[] = [
      { servId: "SYN0000501", servNm: "합성 무분류", ctpvNm: "서울특별시", sggNm: "마포구", lastModYmd: "20261001" },
    ];
    const b = await run({ region: MAPO, stage: "infant" }, createLcgvMock({ list: () => xmlRes(lcgvListXml(rows)) }));
    expect(b.isError).toBe(false);
    expect(b.text).toContain("지역 지원 서비스 조회 결과가 없습니다");
    for (const s of ZERO_SUGGESTIONS) expect(b.text).toContain(s);
    expectFooter(b.text, regionOf(MAPO));
    expect(b.text).toContain(LOCAL_SUPPORT_FRESHNESS);
    expect(b.mock.count()).toBeLessThanOrEqual(4);
  });

  it("AC10 error codes map to distinct guidance", async () => {
    const codes: LcgvErrCode[] = ["12", "20", "30", "31", "22", "23"];
    const texts: string[] = [];
    const byCode = new Map<string, string>();
    for (const c of codes) {
      const r = await run({ region: MAPO }, createLcgvMock({ list: () => lcgvError(c) }));
      expect(r.isError).toBe(true);
      expect(r.mock.count()).toBeLessThanOrEqual(4);
      texts.push(r.text);
      byCode.set(c, r.text);
    }
    const r99 = await run({ region: MAPO }, createLcgvMock({ list: sequence(() => lcgvError("99"), () => lcgvError("99")) }));
    expect(r99.isError).toBe(true);
    texts.push(r99.text);
    const rTimeout = await run({ region: MAPO }, createLcgvMock({ list: hang }), { config: { httpTimeoutMs: 30 } });
    expect(rTimeout.isError).toBe(true);
    texts.push(rTimeout.text);

    expect(new Set(texts).size).toBe(texts.length);
    for (const c of ["20", "30", "31"]) expect(byCode.get(c)).toContain(LCGV_APPLY_ACTION);
    expect(byCode.get("22")).toContain("1,000회");
    expect(byCode.get("23")).toContain("몇 초 뒤");
    expect(r99.text).toContain("응답이 늦어요");
    expect(rTimeout.text).toContain("응답이 늦어요");
    expect(byCode.get("12")).toContain(LCGV_SERVICE_ERROR);
    expect(byCode.get("12")).not.toContain("12)");
    expect(byCode.get("12")).not.toContain("코드 12");

    const ok99 = await run({ region: MAPO }, createLcgvMock({ list: sequence(() => lcgvError("99"), () => lcgvRes("lcgvList/mapo.xml")) }));
    expect(ok99.isError).toBe(false);
    expect(ok99.mock.count()).toBeLessThanOrEqual(4);
  });

  it("AC10 saved response on failure after 12 hours", async () => {
    for (const mode of ["22", "23", "99"] as const) {
      let current: "ok" | LcgvErrCode = "ok";
      const mock = createLcgvMock({
        list: () => (current === "ok" ? lcgvRes("lcgvList/mapo.xml") : lcgvError(current)),
      });
      const ctx = lcgvCtx(mock, { sink: () => undefined });
      const first = await call(ctx, { region: MAPO });
      expect(first.isError).toBe(false);
      ctx.advance(12 * HOUR + 1);
      current = mode;
      const r = await call(ctx, { region: MAPO });
      expect(r.isError).toBe(false);
      expect(r.text).toContain("저장해 둔 응답 · 조회 후 12시간");
      expect(r.text).toContain(LOCAL_SUPPORT_FRESHNESS);
      expect(r.text).toContain("[확인처]");
      expect(r.text).toContain(detailOnlyNote(0));
    }
  });

  it("AC11 no key", async () => {
    const mock = createLcgvMock();
    const ctx = lcgvCtx(mock, { noKey: true });
    const first = await call(ctx, { region: MAPO });
    expect(first.isError).toBe(true);
    expect(first.text).toContain("DATA_GO_KR_SERVICE_KEY");
    expect(first.text).toContain("15108347");
    expect(first.text).toContain(LCGV_APPLY_ACTION);
    expect(mock.count()).toBe(0);
    const second = await call(ctx, { region: MAPO });
    expect(second.text).toBe(first.text);
  });

  it("AC12 constants, wording and key safety", async () => {
    expect(LOCAL_SUPPORT_NOTICE).toBe("공공기관이 제공하는 기능(공개 API)을 이용해 정리한 참고용 정보예요. 신청 조건과 금액은 해당 지자체에 확인하세요.");
    expect(LOCAL_SUPPORT_FRESHNESS).toBe("지자체 지원은 자주 바뀌어요. 지금 신청할 수 있는지와 금액·조건은 복지로 상세와 해당 지자체 공고에서 확인하세요.");
    expect(LOCAL_SUPPORT_STALE_MARK).toBe("수정일이 1년 넘게 지났어요. 지금 내용은 해당 지자체에 확인하세요.");

    const texts: string[] = [];
    const logs: string[] = [];
    const collect = (r: Run): void => {
      texts.push(r.text);
      logs.push(...r.logs);
    };

    const mapo = await run({ region: MAPO }, createLcgvMock({ list: () => lcgvRes("lcgvList/mapo.xml") }));
    collect(mapo);
    const amount = createLcgvMock();
    const amountRun = await run({ region: "경기 안성시", keyword: "출산" }, amount);
    collect(amountRun);
    const zero = await run({ region: MAPO }, createLcgvMock({ list: () => lcgvError("40") }));
    collect(zero);
    const err = await run({ region: MAPO }, createLcgvMock({ list: () => lcgvError("20") }));
    collect(err);
    const stale = createLcgvMock({
      list: sequence(() => lcgvRes("lcgvList/mapo.xml"), () => lcgvError("22")),
    });
    const ctx = lcgvCtx(stale, { sink: () => undefined });
    await call(ctx, { region: MAPO });
    ctx.advance(12 * HOUR + 1);
    const staleText = await call(ctx, { region: MAPO });
    texts.push(staleText.text);
    const noKey = await run({ region: MAPO }, createLcgvMock(), { noKey: true });
    collect(noKey);

    const verbatimMapo = verbatims(lcgvItems("lcgvList/mapo.xml"), detailItemsOf(mapo.mock));
    const verbatimAmount = verbatims(lcgvItems("lcgvList/search-chulsan.xml"), detailItemsOf(amount));
    const verbatimStale = verbatims(lcgvItems("lcgvList/mapo.xml"), detailItemsOf(stale));
    const verbatimList: string[][] = [verbatimMapo, verbatimAmount, [], [], verbatimStale, []];
    const all = [mapo.text, amountRun.text, zero.text, err.text, staleText.text, noKey.text];
    all.forEach((text, i) => {
      expect(text.includes(UNOFFICIAL_KO)).toBe(false);
      expect(/unofficial/i.test(text)).toBe(false);
      const own = ownText(text, verbatimList[i]!);
      expect(NEGATIVE_STEM.test(own)).toBe(false);
      expect(LOCAL_ASSERTIVE.test(own)).toBe(false);
    });

    expect(keySafe(texts, logs)).toBe(true);
    for (const line of logs) {
      expect(line.includes("마포구")).toBe(false);
      expect(line.includes("출산")).toBe(false);
    }
  });
});
