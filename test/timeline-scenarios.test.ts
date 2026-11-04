import { afterEach, describe, expect, it, vi } from "vitest";
import { runTool } from "../src/core/pipeline.js";
import { loadData, resolveBasis } from "../src/data-store/load.js";
import { getTimelineTool } from "../src/tools/get-timeline.js";
import { DISCLAIMER_MEDICAL_LEGAL, NOTICE_SOURCE, NOTICE_VACCINATION_SCOPE } from "../src/tools/shared/format.js";
import { createTestContext } from "./helpers/context.js";

const A = { reference_date: "2026-10-28", due_date: "2027-02-10", birth_order: 1, fetus_count: 1, region: "성동구" };
const B = { reference_date: "2026-10-28", birth_date: "2026-05-28" };
const MAX = { months_ahead: 156, include_past: true };

const text = (r: { content: { type: string; text?: string }[] }): string => r.content[0]!.text ?? "";

function body(t: string): string {
  return t.split("\n\n---\n")[0]!;
}

function footerOf(t: string): string {
  return t.slice(t.indexOf("\n\n---\n"));
}

function countOf(t: string, s: string): number {
  return t.split(s).length - 1;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fixed timeline scenarios", () => {
  it("fixed scenarios are offline, deterministic and snapshotted", async () => {
    vi.stubGlobal("fetch", () => {
      throw new Error("network disabled");
    });
    const lines: string[] = [];
    const ctx = createTestContext({ env: {}, sink: (l) => lines.push(l) });

    const rA1 = await runTool(getTimelineTool, A, ctx);
    const rA2 = await runTool(getTimelineTool, A, ctx);
    const rB1 = await runTool(getTimelineTool, B, ctx);
    const rB2 = await runTool(getTimelineTool, B, ctx);
    expect(rA1.isError).toBeFalsy();
    expect(rB1.isError).toBeFalsy();
    expect(text(rA1)).toBe(text(rA2));
    expect(text(rB1)).toBe(text(rB2));

    const tA = text(rA1);
    const tB = text(rB1);
    await expect(tA).toMatchFileSnapshot("./__snapshots__/timeline-pregnant.txt");
    await expect(tB).toMatchFileSnapshot("./__snapshots__/timeline-born.txt");

    const logged = lines.join("");
    expect(logged).not.toContain("2027-02-10");
    expect(logged).not.toContain("20270210");
    expect(logged).not.toContain("2026-05-28");
    expect(logged).not.toContain("성동구");
  });

  it("item lines carry provenance and order", async () => {
    const itemLine = /^- \[(지난|진행 중|임박|예정)\] \d{4}-\d{2}-\d{2}( ~ \d{4}-\d{2}-\d{2})? \| .+ \| (법정 의무|권장|지원 신청|안내) \| 출처 [^|]+ \| 기준일 \d{4}-\d{2}-\d{2} \| (전체 검증|부분 검증|미검증)$/;

    for (const args of [A, B]) {
      const t = text(await runTool(getTimelineTool, args, createTestContext()));
      const items = body(t)
        .split("\n")
        .filter((l) => l.startsWith("- ["));
      expect(items.length).toBeGreaterThan(0);
      for (const l of items) {
        expect(l).toMatch(itemLine);
        expect(l).not.toMatch(/출처 [a-z0-9-]+(, [a-z0-9-]+)* \|/);
      }

      const starts = items.map((l) => /\] (\d{4}-\d{2}-\d{2})/.exec(l)![1]!);
      expect(starts).toEqual([...starts].sort());

      const footer = footerOf(t);
      expect(footer).toContain(DISCLAIMER_MEDICAL_LEGAL);
      expect(footer).toContain(NOTICE_SOURCE);
      expect(footer).toContain("근거 문서:");
      expect(footer).not.toContain("자동 확인은 아직 제공하지 않");
      expect(footer).toContain("개정 확인 요약:");
      expect(footer).toContain("공휴일: 번들(생성일");
      expect(countOf(t, NOTICE_VACCINATION_SCOPE)).toBe(1);

      const head = t.slice(0, t.indexOf("\n\n---\n"));
      const ids = [...footer.matchAll(/^- \[([a-z0-9-]+)\]/gm)].map((m) => m[1]!);
      expect(ids.length).toBeGreaterThan(0);
      // body source cells (item lines and local guidance lines) show titles, never ids (PUB5 R5)
      const sources = head
        .split("\n")
        .map((l) => / \| 출처 ([^|]+) \| /.exec(l)?.[1])
        .filter((s): s is string => s !== undefined);
      expect(sources.length).toBeGreaterThanOrEqual(items.length);
      const allIds = loadData("basis-documents").documents.map((d) => d.id);
      for (const s of sources) for (const id of allIds) expect(s).not.toContain(id);
      // block basis is footer-only per M59 R6
      const joined = sources.join("\n");
      for (const id of ids.filter((i) => i !== "health-center-standard-data")) {
        expect(joined).toContain(resolveBasis([id])[0]!.title);
      }

      expect(t).not.toContain("자 생략");
    }

    expect(footerOf(text(await runTool(getTimelineTool, B, createTestContext())))).not.toContain("mch-act-rule-annex1");
    expect(footerOf(text(await runTool(getTimelineTool, A, createTestContext())))).toContain("mch-act-rule-annex1");
  });

  it("max window stays within maxChars", async () => {
    const ctx = createTestContext();
    const max = getTimelineTool.maxChars!;
    expect(max).toBeLessThanOrEqual(20000);

    for (const base of [A, B]) {
      const args = { ...base, ...MAX };
      const r = await runTool(getTimelineTool, args, ctx);
      expect(r.isError).toBeFalsy();
      const t = text(r);
      expect(t.length).toBeLessThanOrEqual(max);
      const out = await getTimelineTool.handler(getTimelineTool.schema.parse(args), ctx);
      expect(t.endsWith(out.footer!)).toBe(true);

      const low = await runTool({ ...getTimelineTool, maxChars: out.footer!.length + 400 }, args, ctx);
      expect(low.isError).toBeFalsy();
      const lt = text(low);
      const iCut = lt.indexOf("자 생략");
      const iLocal = lt.indexOf("지역·기관별 확인 사항");
      const iSep = lt.indexOf("\n---\n");
      expect(iCut).toBeGreaterThan(-1);
      expect(iLocal).toBeGreaterThan(iCut);
      expect(iSep).toBeGreaterThan(iLocal);
      expect(lt.endsWith(out.footer!)).toBe(true);
    }
  });
});
