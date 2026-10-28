import { describe, expect, it, vi } from "vitest";
import { resolveHolidayCalendar } from "../src/clients/holiday-resolve.js";
import type { ToolContext } from "../src/core/context.js";
import { addDays, parseDate } from "../src/date/civil-date.js";
import {
  bundledCalendar,
  holidaySourceLabel,
  LIVE_UNAVAILABLE_PREFIX,
  staleBundleNote,
} from "../src/date/holiday-calendar.js";
import { loadData } from "../src/data-store/load.js";
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

const K = "Ab+cD/eF=gH+iJ k/L==";
const FORMS = [K, encodeURIComponent(K), new URLSearchParams({ k: K }).toString().slice(2)];
const ENV = { DATA_GO_KR_SERVICE_KEY: K };
const REF = parseDate("2026-10-28");

function ctxWith(fetchImpl: typeof fetch, env: Record<string, string> = ENV, sink?: (line: string) => void): ToolContext {
  return { ...createTestContext({ env, sink }), fetch: fetchImpl };
}

const code30 = (): Response => xmlRes(kasiXml([], { resultCode: "30" }));

describe("resolveHolidayCalendar", () => {
  it("keyless: bundled only, no network", async () => {
    const spy = vi.fn(() => {
      throw new Error("x");
    });
    const cal = await resolveHolidayCalendar([2026, 2028], ctxWith(spy as unknown as typeof fetch, {}), {
      referenceDate: REF,
    });
    expect(spy).not.toHaveBeenCalled();
    expect(cal.coverage(2026)).toBe("bundled");
    expect(cal.coverage(2028)).toBe("none");
    expect(cal.notes).toEqual(bundledCalendar({ referenceDate: REF }).notes);
    expect(cal.checkedAt).toBeUndefined();
    expect(cal.requestedYears).toEqual([2026, 2028]);
  });

  it("key: sane response becomes live", async () => {
    const mock = createKasiYearMock(okYear);
    const cal = await resolveHolidayCalendar([2026], ctxWith(mock.fetch));
    expect(cal.coverage(2026)).toBe("live");
    expect(cal.notes.some((n) => n.includes(LIVE_UNAVAILABLE_PREFIX))).toBe(false);
    expect(cal.notes.some((n) => n.includes("번들과 다름"))).toBe(false);
    expect(cal.checkedAt).toBe("2026-01-01 00:00");
    expect(mock.urls.length).toBe(1);
  });

  const FAILURES: [string, () => Response | Promise<Response>, boolean][] = [
    ["code 20", () => xmlRes(kasiXml([], { resultCode: "20" })), true],
    ["code 30", code30, false],
    ["code 22", () => xmlRes(kasiXml([], { resultCode: "22" })), false],
    ["code 23", () => xmlRes(kasiXml([], { resultCode: "23" })), false],
    ["code 31", () => xmlRes(kasiXml([], { resultCode: "31" })), false],
    ["html 200", () => htmlRes200(), false],
    ["empty body", () => emptyRes(), false],
    [
      "sanity failure",
      () => xmlRes(kasiXml(entriesToItems(bundledYearEntries(2026).filter((e) => e.date !== "2026-05-01")))),
      false,
    ],
    [
      "truncated",
      () => xmlRes(kasiXml(entriesToItems(bundledYearEntries(2026)), { totalCount: 999 })),
      false,
    ],
    ["network error", () => Promise.reject(new TypeError("net")), false],
  ];

  it.each(FAILURES)("key: failure falls back to bundle (%s)", async (_name, make, isCode20) => {
    const mock = createKasiYearMock(() => make());
    const cal = await resolveHolidayCalendar([2026], ctxWith(mock.fetch));
    expect(cal.coverage(2026)).toBe("bundled");
    expect(cal.isPublicHoliday(parseDate("2026-05-01"))).toBe(true);
    const first = cal.notes[0] ?? "";
    expect(first.startsWith(LIVE_UNAVAILABLE_PREFIX)).toBe(true);
    expect(first.includes("활용신청")).toBe(isCode20);
  });

  it("deadline: slow year returns bundled within deadline", async () => {
    const mock = createKasiYearMock((_year, init) => hangUntilAbort(init));
    const started = Date.now();
    const cal = await resolveHolidayCalendar([2026], ctxWith(mock.fetch), { deadlineMs: 200 });
    expect(Date.now() - started).toBeLessThan(1500);
    expect(cal.coverage(2026)).toBe("bundled");
    expect(cal.notes.some((n) => n.startsWith(LIVE_UNAVAILABLE_PREFIX))).toBe(true);
  });

  it("never throws on synchronous fetch error and skips out-of-range years", async () => {
    const spy = vi.fn(() => {
      throw new Error("sync");
    });
    const cal = await resolveHolidayCalendar([2026], ctxWith(spy as unknown as typeof fetch));
    expect(cal.coverage(2026)).toBe("bundled");
    expect(cal.notes.some((n) => n.startsWith(LIVE_UNAVAILABLE_PREFIX))).toBe(true);

    const mock = createKasiYearMock(okYear);
    const out = await resolveHolidayCalendar([1999], ctxWith(mock.fetch));
    expect(mock.urls.length).toBe(0);
    expect(out.coverage(1999)).toBe("none");
    expect(out.notes.some((n) => n.includes(LIVE_UNAVAILABLE_PREFIX))).toBe(false);
  });

  it("diff: live differs from bundle", async () => {
    const changed = [
      ...bundledYearEntries(2026).filter((e) => e.date !== "2026-06-03"),
      { date: "2026-11-10", name: "임시공휴일(테스트)" },
    ];
    const mock = createKasiYearMock(() => xmlRes(kasiXml(entriesToItems(changed))));
    const cal = await resolveHolidayCalendar([2026], ctxWith(mock.fetch));
    expect(cal.coverage(2026)).toBe("live");
    expect(cal.isPublicHoliday(parseDate("2026-11-10"))).toBe(true);
    expect(cal.isPublicHoliday(parseDate("2026-06-03"))).toBe(false);
    const diff = cal.notes.find((n) => n.includes("번들과 다름")) ?? "";
    expect(diff.includes("추가 2026-11-10 임시공휴일(테스트)")).toBe(true);
    expect(diff.includes("삭제 2026-06-03")).toBe(true);

    const same = createKasiYearMock(okYear);
    const cal2 = await resolveHolidayCalendar([2026], ctxWith(same.fetch));
    expect(cal2.notes.some((n) => n.includes("번들과 다름"))).toBe(false);
  });

  it("mixed: per-year source", async () => {
    const mock = createKasiYearMock((year) => {
      if (year === 2026) return okYear(2026);
      if (year === 2027) return code30();
      return xmlRes(kasiXml([]));
    });
    const cal = await resolveHolidayCalendar([2026, 2027, 2028], ctxWith(mock.fetch));
    expect(cal.coverage(2026)).toBe("live");
    expect(cal.coverage(2027)).toBe("bundled");
    expect(cal.coverage(2028)).toBe("none");
    const prefixNote = cal.notes.find((n) => n.startsWith(LIVE_UNAVAILABLE_PREFIX)) ?? "";
    expect(prefixNote.includes("2027·2028년")).toBe(true);
    const label = holidaySourceLabel(cal, loadData("holidays").generated_at);
    expect(label).toContain("2026년 공공데이터 API 확인(조회 시각");
    expect(label).toContain("2027년 번들(생성일 2026-10-28)");
    expect(label).toContain("2028년 정보 없음");
  });

  it("cache: one call per year, failures retried", async () => {
    const okMock = createKasiYearMock(okYear);
    const ctx = ctxWith(okMock.fetch);
    await resolveHolidayCalendar([2026, 2027], ctx);
    await resolveHolidayCalendar([2026, 2027], ctx);
    expect(okMock.urls.map((u) => new URL(u).searchParams.get("solYear")).sort()).toEqual(["2026", "2027"]);

    const seenFail = new Set<number>();
    const retryMock = createKasiYearMock((year) => {
      if (!seenFail.has(year)) {
        seenFail.add(year);
        return code30();
      }
      return okYear(year);
    });
    const retryCtx = ctxWith(retryMock.fetch);
    const first = await resolveHolidayCalendar([2026], retryCtx);
    expect(first.coverage(2026)).toBe("bundled");
    expect(first.notes.some((n) => n.startsWith(LIVE_UNAVAILABLE_PREFIX))).toBe(true);
    const second = await resolveHolidayCalendar([2026], retryCtx);
    expect(second.coverage(2026)).toBe("live");
    expect(retryMock.urls.length).toBe(2);

    const seenHang = new Set<number>();
    const hangMock = createKasiYearMock((year, init) => {
      if (!seenHang.has(year)) {
        seenHang.add(year);
        return hangUntilAbort(init);
      }
      return okYear(year);
    });
    const hangCtx = ctxWith(hangMock.fetch);
    const h1 = await resolveHolidayCalendar([2026], hangCtx, { deadlineMs: 200 });
    expect(h1.coverage(2026)).toBe("bundled");
    await new Promise((r) => setTimeout(r, 20));
    const h2 = await resolveHolidayCalendar([2026], hangCtx, { deadlineMs: 200 });
    expect(h2.coverage(2026)).toBe("live");
    expect(hangMock.urls.length).toBe(2);
  });

  it("stale warning kept unless all requested years are live", async () => {
    const generated = parseDate(loadData("holidays").generated_at);
    const ref = addDays(generated, 200);

    const allMock = createKasiYearMock(okYear);
    const all = await resolveHolidayCalendar([2026, 2027], ctxWith(allMock.fetch), { referenceDate: ref });
    expect(all.notes).not.toContain(staleBundleNote(generated));

    const partialMock = createKasiYearMock((year) => (year === 2027 ? code30() : okYear(year)));
    const partial = await resolveHolidayCalendar([2026, 2027], ctxWith(partialMock.fetch), { referenceDate: ref });
    expect(partial.notes).toContain(staleBundleNote(generated));
  });

  it("key never appears in notes or logs", async () => {
    const scenarios: [(init?: RequestInit) => Response | Promise<Response>, number | undefined][] = [
      [() => okYear(2026), undefined],
      [() => xmlRes(kasiXml([], { resultCode: "20" })), undefined],
      [code30, undefined],
      [() => htmlRes200(), undefined],
      [() => emptyRes(), undefined],
      [(init) => hangUntilAbort(init), 200],
    ];
    for (const [make, deadlineMs] of scenarios) {
      const lines: string[] = [];
      const mock = createKasiYearMock((_year, init) => make(init));
      const cal = await resolveHolidayCalendar([2026], ctxWith(mock.fetch, ENV, (line) => lines.push(line)), {
        deadlineMs,
      });
      const text = [cal.notes.join("\n"), lines.join("\n"), holidaySourceLabel(cal, loadData("holidays").generated_at)].join(
        "\n",
      );
      for (const form of FORMS) {
        expect(text.includes(form)).toBe(false);
      }
    }
  });
});
