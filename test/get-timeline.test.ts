import { afterEach, describe, expect, it, vi } from "vitest";
import { addDays, formatDate, parseDate } from "../src/date/civil-date.js";
import { STALE_AFTER_DAYS } from "../src/date/holiday-calendar.js";
import { loadData } from "../src/data-store/load.js";
import { runTool } from "../src/core/pipeline.js";
import { getTimelineTool } from "../src/tools/get-timeline.js";
import { DISCLAIMER_MEDICAL_LEGAL, NOTICE_UNOFFICIAL, NOTICE_VACCINATION_SCOPE } from "../src/tools/shared/format.js";
import { createTestContext } from "./helpers/context.js";

const call = (args: Record<string, unknown>, ctx = createTestContext()) => runTool(getTimelineTool, args, ctx);
const text = (r: { content: { type: string; text?: string }[] }): string => r.content[0]!.text ?? "";

function body(t: string): string {
  return t.split("\n\n---\n")[0]!;
}

function blocks(t: string): string[] {
  return body(t).split(/\n(?=- \[)/);
}

function countOf(t: string, s: string): number {
  return t.split(s).length - 1;
}

function registrationBlock(t: string): string {
  const start = t.indexOf("| 출생신고 기한");
  const rest = t.slice(start);
  const next = rest.indexOf("\n- ");
  return next === -1 ? rest : rest.slice(0, next);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("get_timeline", () => {
  it("rejects invalid input with field and example", async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ birth_date: "2026-02-30" }, "birth_date"],
      [{}, "birth_date"],
      [{ birth_date: "2026-01-31", reference_date: "2026-02-01", months_ahead: 0 }, "months_ahead"],
      [{ birth_date: "2026-01-31", reference_date: "2026-02-01", months_ahead: 157 }, "months_ahead"],
    ];
    for (const [args, field] of cases) {
      const r = await call(args);
      expect(r.isError, JSON.stringify(args)).toBe(true);
      expect(text(r)).toContain(field);
      expect(text(r)).toContain("예:");
    }
    const early = await call({ birth_date: "2026-01-31", reference_date: "2026-01-30" });
    expect(early.isError).toBe(true);
    expect(text(early)).toContain("임신 중");
    expect(text(early)).toContain("due_date");
    expect(text(early)).toContain("예:");
  });

  it("accepts alternate formats and string flags", async () => {
    const r = await call({ birth_date: "20260131", reference_date: "2026.02.01", months_ahead: "24", include_past: "true" });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toContain("2026-03-03");

    const d = await call({ birth_date: "2025-12-01" });
    expect(d.isError).toBeFalsy();
    expect(text(d)).toContain("기준일 2026-01-01");
  });

  it("birth registration deadlines", async () => {
    const r = await call({ birth_date: "2026-01-31", reference_date: "2026-02-01" });
    const t = text(r);
    expect(t).toContain("2026-01-31 ~ 2026-03-03 | 출생신고 기한");
    expect(t).toContain("원래 말일 2026-02-28");
    expect(t).toContain("family-registration-act");
    expect(t).toContain("부분 검증");
    expect(t).toContain("관할");

    const late = text(await call({ birth_date: "2026-03-10", reference_date: "2026-03-10" }));
    expect(late).toContain("2026-03-10 ~ 2026-04-09 | 출생신고 기한");
    expect(registrationBlock(late)).not.toContain("원래 말일");
  });

  it("benefit deadlines", async () => {
    const t = text(await call({ birth_date: "2026-01-31", reference_date: "2026-02-01" }));
    expect(t).toContain("2026-01-31 ~ 2026-03-31 | 부모급여 신청 기한");
    expect(t).toContain("2026-01-31 ~ 2026-03-31 | 아동수당 신청 기한");
    expect(t).toContain("지원 신청");

    const chuseok = text(await call({ birth_date: "2026-07-29", reference_date: "2026-07-29" }));
    const lines = body(chuseok)
      .split("\n")
      .filter((l) => l.startsWith("- [") && (l.includes("| 부모급여 신청 기한") || l.includes("| 아동수당 신청 기한")));
    expect(lines).toHaveLength(2);
    for (const l of lines) expect(l).toContain("~ 2026-09-28");
    expect(chuseok).toContain("원래 말일 2026-09-26");
  });

  it("all checkups with include_past and 156 months", async () => {
    const r = await call({ birth_date: "2026-01-31", reference_date: "2026-02-01", months_ahead: 156, include_past: true });
    const t = text(r);
    expect(t).toContain("2026-02-14 ~ 2026-03-07");
    expect(t).toContain("2026-05-31 ~ 2026-08-30");
    expect(t).toContain("2027-07-31 ~ 2028-07-30");
    expect(t.match(/\| 영유아 건강검진 \d차/g)).toHaveLength(8);
    expect(t.match(/\| 영유아 구강검진 \d차/g)).toHaveLength(4);

    const itemLine = /^- \[(지난|진행 중|임박|예정)\] \d{4}-\d{2}-\d{2}( ~ \d{4}-\d{2}-\d{2})? \| .+ \| (법정 의무|권장|지원 신청|안내) \| 출처 [a-z0-9-]+(, [a-z0-9-]+)* \| 기준일 \d{4}-\d{2}-\d{2} \| (검증됨|부분 검증|미검증)$/;
    const items = body(t).split("\n").filter((l) => l.startsWith("- ["));
    expect(items.length).toBeGreaterThan(0);
    for (const l of items) expect(l).toMatch(itemLine);
    for (const l of items.filter((l) => l.includes("| 영유아"))) expect(l).toContain("부분 검증");

    const shifted = text(await call({ birth_date: "2025-08-31", reference_date: "2026-05-01" }));
    expect(shifted).toContain("2026-05-31 ~ 2026-09-29");
  });

  it("deterministic output and sorted by start", async () => {
    const args = { birth_date: "2026-01-31", reference_date: "2026-02-01", months_ahead: 156, include_past: true };
    const a = text(await call(args));
    const b = text(await call(args));
    expect(a).toBe(b);

    const starts = body(a)
      .split("\n")
      .filter((l) => l.startsWith("- ["))
      .map((l) => /\] (\d{4}-\d{2}-\d{2})/.exec(l)![1]!);
    const sorted = [...starts].sort();
    expect(starts).toEqual(sorted);
  });

  it("window and hidden counts", async () => {
    const past = text(await call({ birth_date: "2026-05-28", reference_date: "2026-10-28" }));
    expect(past).not.toContain("[지난]");
    expect(past).toContain("지난 항목");
    expect(past).toContain("개 숨김");
    expect(past).toContain("[진행 중] 2026-09-28 ~ 2026-12-27 | 영유아 건강검진 2차");
    expect(past).not.toContain("영유아 건강검진 1차");
    expect(past).toContain("[예정] 2027-02-28");

    const withPast = text(await call({ birth_date: "2026-05-28", reference_date: "2026-10-28", include_past: true }));
    expect(withPast).toContain("[지난]");
    expect(withPast).toContain("영유아 건강검진 1차");

    const future = text(await call({ birth_date: "2026-01-31", reference_date: "2026-02-01", months_ahead: 1 }));
    expect(future).toMatch(/먼 미래 항목 \d+개 숨김/);

    const empty = await call({ birth_date: "2005-01-01", reference_date: "2026-01-01" });
    expect(empty.isError).toBeFalsy();
    expect(text(empty)).toContain("표시할 항목이 없습니다");
    expect(text(empty)).not.toContain(NOTICE_VACCINATION_SCOPE);
  });

  it("bundle range and staleness warnings", async () => {
    const h = loadData("holidays");
    const last = Math.max(...h.covers_years);
    const edge = text(await call({ birth_date: `${last}-12-15`, reference_date: `${last}-12-15` }));
    expect(edge).toContain(`${last + 1}년 공휴일 정보 없음`);

    const staleRef = formatDate(addDays(parseDate(h.generated_at), STALE_AFTER_DAYS));
    const stale = text(await call({ birth_date: "2026-01-31", reference_date: staleRef }));
    expect(stale).toContain("임시공휴일");

    for (const t of [edge, stale]) {
      expect(t).toContain(`공휴일: 번들(생성일 ${h.generated_at})`);
    }
  });

  it("footer survives truncation", async () => {
    const args = { birth_date: "2026-01-31", reference_date: "2026-02-01", months_ahead: 156, include_past: true };
    const ctx = createTestContext();
    const out = await getTimelineTool.handler(getTimelineTool.schema.parse(args), ctx);
    const r = await runTool({ ...getTimelineTool, maxChars: (out.footer ?? "").length + 400 }, args, ctx);
    expect(r.isError).toBeFalsy();
    const t = text(r);
    expect(t.endsWith(out.footer!)).toBe(true);
    expect(t).toContain("자 생략");
    expect(t).toContain(DISCLAIMER_MEDICAL_LEGAL);
    expect(t).toContain(NOTICE_UNOFFICIAL);
    expect(t).toContain("개정 여부 자동 확인은 아직 제공하지 않");
    expect(t).toContain("근거 문서:");
    expect(t).toContain(NOTICE_VACCINATION_SCOPE);
  });

  it("offline, keyless, no birth date in logs", async () => {
    const fetchStub = vi.fn(() => {
      throw new Error("network disabled");
    });
    vi.stubGlobal("fetch", fetchStub);
    const lines: string[] = [];
    const ctx = createTestContext({ sink: (l) => lines.push(l) });
    const r = await call({ birth_date: "2026-01-31", reference_date: "2026-02-01" }, ctx);
    expect(r.isError).toBeFalsy();
    expect(fetchStub).not.toHaveBeenCalled();
    const logged = lines.join("");
    expect(logged).not.toContain("2026-01-31");
    expect(logged).not.toContain("20260131");
    expect(logged).not.toContain("2026-02-01");
  });

  it("max output within maxChars", async () => {
    const args = { birth_date: "2026-01-31", reference_date: "2026-02-01", months_ahead: 156, include_past: true };
    const r = await call(args);
    const t = text(r);
    const max = getTimelineTool.maxChars!;
    expect(max).toBeLessThanOrEqual(20000);
    expect(t.length).toBeLessThanOrEqual(max);
    expect(t).not.toContain("자 생략");
    expect(t).toContain(DISCLAIMER_MEDICAL_LEGAL);
    expect(t).toContain(NOTICE_UNOFFICIAL);
    expect(t).toContain("근거 문서:");
    expect(countOf(t, NOTICE_VACCINATION_SCOPE)).toBe(1);
    expect(getTimelineTool.requiredKeys === undefined || getTimelineTool.requiredKeys.length === 0).toBe(true);
  });

  it("vaccination items in default window, offline and deterministic", async () => {
    const fetchStub = vi.fn(() => {
      throw new Error("network disabled");
    });
    vi.stubGlobal("fetch", fetchStub);
    const args = { birth_date: "2026-05-28", reference_date: "2026-10-28" };
    const a = await call(args);
    const b = await call(args);
    expect(a.isError).toBeFalsy();
    expect(b.isError).toBeFalsy();
    const t = text(a);
    expect(text(b)).toBe(t);
    expect(fetchStub).not.toHaveBeenCalled();
    expect(t).toContain("[예정] 2026-11-28 ~ 2026-12-27 | DTaP 3차 (6개월)");
    expect(t).toContain("[예정] 2026-11-28 ~ 2027-04-30 | 인플루엔자 (2026-2027 절기)");
    expect(t).toContain("안내: 인플루엔자: 등록된 절기(2026-2027 절기) 이후 정보 없음");
    expect(t).not.toContain("자 생략");
    expect(countOf(t, NOTICE_VACCINATION_SCOPE)).toBe(1);

    const starts = blocks(t)
      .map((b) => /\] (\d{4}-\d{2}-\d{2})/.exec(b)?.[1])
      .filter((s): s is string => s !== undefined);
    expect(starts.length).toBeGreaterThan(0);
    expect(starts).toEqual([...starts].sort());
  });

  it("all 13 vaccines with include_past and 156 months", async () => {
    const r = await call({ birth_date: "2026-01-31", reference_date: "2026-02-01", months_ahead: 156, include_past: true });
    const t = text(r);
    const markers = [
      "| BCG",
      "| B형간염",
      "| DTaP",
      "| IPV",
      "| Hib",
      "| PCV",
      "| 로타바이러스 RV1",
      "| 로타바이러스 RV5",
      "| MMR",
      "| 수두",
      "| A형간염",
      "| 일본뇌염",
      "| HPV",
      "| 인플루엔자",
    ];
    for (const m of markers) expect(body(t)).toContain(m);

    const unverified = blocks(t).filter((b) => /^- .*\| (로타바이러스|HPV)/.test(b.split("\n")[0]!));
    expect(unverified.length).toBeGreaterThan(0);
    for (const b of unverified) {
      expect(b.split("\n")[0]!.endsWith("| 미검증")).toBe(true);
      expect(b).toContain("지침 원문");
    }
    const rota = unverified.filter((b) => b.includes("| 로타바이러스"));
    expect(rota.length).toBeGreaterThan(0);
    for (const b of rota) expect(b).toContain("택일");

    const partial = blocks(t).filter((b) =>
      /\| (BCG|B형간염|DTaP|IPV|Hib|PCV|MMR|수두|A형간염|일본뇌염|인플루엔자)/.test(b.split("\n")[0]!),
    );
    expect(partial.length).toBeGreaterThan(0);
    for (const b of partial) expect(b.split("\n")[0]!.endsWith("| 부분 검증")).toBe(true);

    const footer = t.slice(t.indexOf("\n\n---\n"));
    expect(footer).toContain("kdca-guideline-2026");
    expect(footer).toContain("kdca-nip-influenza");
    expect(footer).not.toContain("mch-act-rule-annex1");
    expect(footer).not.toContain("산전");
    expect(countOf(t, NOTICE_VACCINATION_SCOPE)).toBe(1);
  });
});
