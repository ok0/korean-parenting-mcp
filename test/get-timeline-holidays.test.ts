import { afterEach, describe, expect, it, vi } from "vitest";
import { computeDeadline } from "../src/date/legal-period.js";
import { buildTimeline } from "../src/timeline/engine.js";
import type { TimelineInput } from "../src/timeline/types.js";
import { findDeadline } from "../src/timeline/rules/common.js";
import type { ToolContext } from "../src/core/context.js";
import { runTool } from "../src/core/pipeline.js";
import { loadData } from "../src/data-store/load.js";
import { compare, formatDate, parseDate } from "../src/date/civil-date.js";
import { bundledCalendar, createCalendar, LIVE_UNAVAILABLE_PREFIX } from "../src/date/holiday-calendar.js";
import { getTimelineTool } from "../src/tools/get-timeline.js";
import { createTestContext } from "./helpers/context.js";
import {
  bundledYearEntries,
  createKasiYearMock,
  emptyRes,
  entriesToItems,
  hangUntilAbort,
  htmlRes200,
  kasiXml,
  okYear,
  xmlRes,
} from "./helpers/kasi-mock.js";
import { createLawMock, sameAsStored } from "./helpers/law-mock.js";

const K = "Ab+cD/eF=gH+iJ k/L==";
const FORMS = [K, encodeURIComponent(K), new URLSearchParams({ k: K }).toString().slice(2)];
const ENV = { DATA_GO_KR_SERVICE_KEY: K };
const FAKE = "ab+c/d=e1";

const B = { reference_date: "2026-10-28", birth_date: "2026-05-28", include_past: true };
const A = { reference_date: "2026-10-28", due_date: "2027-02-10", birth_order: 1, fetus_count: 1, region: "성동구" };
const DEADLINE_IDS = ["birth-registration", "parent-allowance", "child-allowance", "first-meeting"];

type Route = (year: number, init?: RequestInit) => Response | Promise<Response>;

afterEach(() => {
  vi.unstubAllGlobals();
});

function text(r: { content: { type: string; text?: string }[] }): string {
  return r.content[0]!.text ?? "";
}

function body(t: string): string {
  return t.split("\n\n---\n")[0]!;
}

function footerOf(t: string): string {
  return t.slice(t.indexOf("\n\n---\n"));
}

function stripLive(f: string): string {
  return f
    .split("\n")
    .filter((l) => l !== "주의:" && !l.startsWith(`- ${LIVE_UNAVAILABLE_PREFIX}`))
    .join("\n");
}

function ctxWith(fetchImpl: typeof fetch, env: Record<string, string> = ENV, sink?: (line: string) => void): ToolContext {
  return { ...createTestContext({ env, sink }), fetch: fetchImpl };
}

async function keyless(args: unknown): Promise<string> {
  return text(await runTool(getTimelineTool, args, createTestContext()));
}

function kasiYears(urls: readonly string[]): number[] {
  return [...new Set(urls.map((u) => Number(new URL(u).searchParams.get("solYear"))))].sort((a, b) => a - b);
}

function countByYear(urls: readonly string[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const y of kasiYears(urls)) {
    counts.set(y, urls.filter((u) => Number(new URL(u).searchParams.get("solYear")) === y).length);
  }
  return counts;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function expectedYears(input: Omit<TimelineInput, "holidays">): number[] {
  const result = buildTimeline({ ...input, holidays: bundledCalendar(), includePast: true, monthsAhead: 156 });
  const ys = new Set<number>();
  for (const item of result.items) {
    if (!DEADLINE_IDS.includes(item.id)) continue;
    if (item.end) ys.add(item.end.y);
    for (const note of item.notes) {
      const m = /원래 말일 (\d{4})-/.exec(note);
      if (m) ys.add(Number(m[1]));
    }
  }
  return [...ys].sort((a, b) => a - b);
}

describe("get_timeline runtime holidays", () => {
  it("AC1 all requested years live", async () => {
    const mock = createKasiYearMock(okYear);
    const r = await runTool(getTimelineTool, B, ctxWith(mock.fetch));
    const t = text(r);
    expect(r.isError).toBeFalsy();
    expect(footerOf(t)).toContain("공휴일: 공공데이터 API 확인(조회 시각 2026-01-01 00:00 KST)");
    expect(t.includes(LIVE_UNAVAILABLE_PREFIX)).toBe(false);
    expect(body(t).includes("2028년 공휴일 정보 없음")).toBe(false);
  });

  const AC2_CASES: { name: string; route: Route; env: Record<string, string> }[] = [
    { name: "code 20", route: (() => xmlRes(kasiXml([], { resultCode: "20" }))) as Route, env: {} },
    { name: "code 30", route: (() => xmlRes(kasiXml([], { resultCode: "30" }))) as Route, env: {} },
    { name: "timeout", route: ((_y: number, init?: RequestInit) => hangUntilAbort(init)) as Route, env: { KPM_LAW_TIMEOUT_MS: "500" } },
    {
      name: "labor day missing",
      route: ((y: number) => xmlRes(kasiXml(entriesToItems(bundledYearEntries(y).filter((e) => e.date !== `${y}-05-01`))))) as Route,
      env: {},
    },
    { name: "empty response", route: (() => emptyRes()) as Route, env: {} },
    { name: "html 200", route: (() => htmlRes200()) as Route, env: {} },
  ];

  it.each(AC2_CASES)("AC2 failure → bundled timeline: $name", async ({ route, env }) => {
    const mock = createKasiYearMock(route);
    const k = await keyless(B);
    const started = Date.now();
    const r = await runTool(getTimelineTool, B, ctxWith(mock.fetch, { ...ENV, ...env }));
    const elapsed = Date.now() - started;
    const t = text(r);
    expect(r.isError).toBeFalsy();
    expect(body(t)).toBe(body(k));
    expect(footerOf(t)).toContain("공휴일 실시간 확인 불가");
    expect(stripLive(footerOf(t))).toBe(stripLive(footerOf(k)));
    if (env.KPM_LAW_TIMEOUT_MS) expect(elapsed).toBeLessThan(2000);
  });

  it("AC2 code 20 footer names the application check", async () => {
    const mock = createKasiYearMock(() => xmlRes(kasiXml([], { resultCode: "20" })));
    const t = text(await runTool(getTimelineTool, B, ctxWith(mock.fetch)));
    expect(footerOf(t)).toContain("활용신청");
  });

  it("AC3 live extra holiday extends deadline and is reported", async () => {
    const rule = findDeadline("birth-registration").rule;
    const e = computeDeadline(parseDate("2026-05-28"), rule, bundledCalendar()).end;
    const live2026 = [...bundledYearEntries(2026), { date: formatDate(e), name: "임시공휴일(테스트)" }].sort((a, b) =>
      a.date.localeCompare(b.date),
    );
    const e2 = computeDeadline(
      parseDate("2026-05-28"),
      rule,
      createCalendar({
        2026: { source: "live", entries: live2026 },
        2027: { source: "bundled", entries: bundledYearEntries(2027) },
      }),
    ).end;
    expect(compare(e2, e)).toBeGreaterThan(0);

    const route: Route = (y) => (y === 2026 ? xmlRes(kasiXml(entriesToItems(live2026))) : okYear(y));
    const k = await keyless(B);
    const t = text(await runTool(getTimelineTool, B, ctxWith(createKasiYearMock(route).fetch)));
    const line = (s: string): string | undefined => body(s).split("\n").find((l) => l.startsWith("- [") && l.includes("출생신고"));
    expect(line(t)).toBeDefined();
    expect(line(t)!.includes(formatDate(e2))).toBe(true);
    expect(line(t)).not.toBe(line(k));
    expect(footerOf(t)).toContain(`추가 ${formatDate(e)} 임시공휴일(테스트)`);

    const same = text(await runTool(getTimelineTool, B, ctxWith(createKasiYearMock(okYear).fetch)));
    expect(footerOf(same).includes("번들과 다름")).toBe(false);
  });

  it("AC4 keyless: zero KASI calls, output unchanged", async () => {
    const spy = vi.fn(() => {
      throw new Error("network disabled");
    });
    vi.stubGlobal("fetch", spy);
    const ctx = { ...createTestContext({ env: {} }), fetch: spy as unknown as typeof fetch };
    for (const args of [A, B, { ...B, months_ahead: 156 }]) {
      const r = await runTool(getTimelineTool, args, ctx);
      expect(r.isError).toBeFalsy();
      const t = text(r);
      expect(footerOf(t)).toContain(`공휴일: 번들(생성일 ${loadData("holidays").generated_at})`);
      expect(t.includes(LIVE_UNAVAILABLE_PREFIX)).toBe(false);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("AC5 cache: one KASI call per year; failure retried", async () => {
    const mock = createKasiYearMock(okYear);
    const ctx = ctxWith(mock.fetch);
    const first = text(await runTool(getTimelineTool, B, ctx));
    const second = text(await runTool(getTimelineTool, B, ctx));
    expect(countByYear(mock.urls).size).toBeGreaterThan(0);
    for (const count of countByYear(mock.urls).values()) expect(count).toBe(1);
    expect(second).toBe(first);

    const calls = new Map<number, number>();
    const flaky = createKasiYearMock((y) => {
      const n = (calls.get(y) ?? 0) + 1;
      calls.set(y, n);
      return n === 1 ? xmlRes(kasiXml([], { resultCode: "30" })) : okYear(y);
    });
    const retryCtx = ctxWith(flaky.fetch);
    const r1 = footerOf(text(await runTool(getTimelineTool, B, retryCtx)));
    const r2 = footerOf(text(await runTool(getTimelineTool, B, retryCtx)));
    expect(r1).toContain(LIVE_UNAVAILABLE_PREFIX);
    expect(r2).toContain("공공데이터 API 확인");
    for (const count of countByYear(flaky.urls).values()) expect(count).toBe(2);
  });

  it("AC6 mixed sources and out-of-bundle year", async () => {
    const X = { reference_date: "2026-11-25", birth_date: "2026-11-20", include_past: true };
    const route: Route = (y) => {
      if (y === 2026) return okYear(y);
      if (y === 2027) return xmlRes(kasiXml([], { resultCode: "30" }));
      return xmlRes(kasiXml([]));
    };
    const mock = createKasiYearMock(route);
    const t = text(await runTool(getTimelineTool, X, ctxWith(mock.fetch)));
    const years = kasiYears(mock.urls);
    expect(years, "fixture precondition: 2026·2027·2028 requested").toEqual(expect.arrayContaining([2026, 2027, 2028]));
    const footer = footerOf(t);
    expect(footer).toContain("2026년 공공데이터 API 확인");
    expect(footer).toContain("2027년 번들(생성일");
    expect(footer).toContain("2028년 정보 없음");
    expect(body(t)).toContain("2028년 공휴일 정보 없음");
    expect(body(t)).toBe(body(await keyless(X)));
  });

  it.each([
    {
      name: "(i) 2026-12-10 birth",
      args: { reference_date: "2026-12-20", birth_date: "2026-12-10" },
      input: { mode: "born", birthDate: parseDate("2026-12-10"), referenceDate: parseDate("2026-12-20") } as Omit<TimelineInput, "holidays">,
    },
    {
      name: "(ii) pregnancy A",
      args: A,
      input: {
        mode: "pregnant",
        birthDate: parseDate("2027-02-10"),
        dueDate: parseDate("2027-02-10"),
        referenceDate: parseDate("2026-10-28"),
        region: "성동구",
        birthOrder: 1,
        fetusCount: 1,
      } as Omit<TimelineInput, "holidays">,
    },
    {
      name: "(iii) born B",
      args: B,
      input: { mode: "born", birthDate: parseDate("2026-05-28"), referenceDate: parseDate("2026-10-28") } as Omit<TimelineInput, "holidays">,
    },
  ])("AC7 requested years cover every holiday-dependent deadline: $name", async ({ args, input }) => {
    const expected = expectedYears(input);
    expect(expected.length).toBeGreaterThan(0);
    const mock = createKasiYearMock(okYear);
    await runTool(getTimelineTool, args, ctxWith(mock.fetch));
    const requested = kasiYears(mock.urls);
    for (const y of expected) expect(requested).toContain(y);
  });

  it("AC7 holiday resolve and revision check do not wait for each other", async () => {
    const sawKasi = deferred();
    const sawLaw = deferred();
    const lawMock = createLawMock(sameAsStored(FAKE));
    const combined = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(href);
      if (url.host === "apis.data.go.kr") {
        sawKasi.resolve();
        await sawLaw.promise;
        return okYear(Number(url.searchParams.get("solYear")));
      }
      sawLaw.resolve();
      await sawKasi.promise;
      return lawMock.fetch(input, init);
    };
    const t = text(await runTool(getTimelineTool, B, ctxWith(combined as typeof fetch, { ...ENV, LAW_OC: FAKE })));
    expect(footerOf(t)).toContain("공공데이터 API 확인");
    expect(footerOf(t)).toMatch(/원문 확인 [1-9]\d*/);
    expect(t.includes(LIVE_UNAVAILABLE_PREFIX)).toBe(false);
  });

  it("AC8 key and user input never leak", async () => {
    const scenarios: { route: Route; env: Record<string, string> }[] = [
      { route: okYear, env: {} },
      { route: () => xmlRes(kasiXml([], { resultCode: "20" })), env: {} },
      { route: () => xmlRes(kasiXml([], { resultCode: "30" })), env: {} },
      { route: (_y, init) => hangUntilAbort(init), env: { KPM_LAW_TIMEOUT_MS: "500" } },
      { route: () => emptyRes(), env: {} },
      { route: () => htmlRes200(), env: {} },
    ];
    const allowedKeys = new Set(["serviceKey", "solYear", "pageNo", "numOfRows"]);
    for (const { route, env } of scenarios) {
      const sink: string[] = [];
      const mock = createKasiYearMock(route);
      const r = await runTool(getTimelineTool, A, ctxWith(mock.fetch, { ...ENV, ...env }, (line) => sink.push(line)));
      const all = text(r) + "\n" + sink.join("\n");
      for (const form of FORMS) expect(all.includes(form)).toBe(false);
      for (const href of mock.urls) {
        const u = new URL(href);
        for (const key of u.searchParams.keys()) expect(allowedKeys.has(key)).toBe(true);
        expect(u.searchParams.get("solYear")).toMatch(/^\d{4}$/);
        for (const leak of ["2027-02-10", "20270210", "2026-10-28", "20261028", "성동구", encodeURIComponent("성동구")]) {
          expect(href.includes(leak)).toBe(false);
        }
      }
    }
  });
});
