import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { formatDate, parseDate, type CivilDate } from "../src/date/civil-date.js";
import { bundledCalendar } from "../src/date/holiday-calendar.js";
import { loadData } from "../src/data-store/load.js";
import type { TimelineInput, TimelineItem } from "../src/timeline/types.js";
import { benefitDeadlineRule } from "../src/timeline/rules/benefit-deadlines.js";
import {
  childAllowanceItems,
  firstMeetingItems,
  medicalCostItems,
  parentAllowanceItems,
} from "../src/timeline/rules/benefits.js";
import { fallbackNote, selectVersion } from "../src/timeline/rules/common.js";
import { runTool } from "../src/core/pipeline.js";
import { getTimelineTool } from "../src/tools/get-timeline.js";
import { createTestContext } from "./helpers/context.js";

const cal = bundledCalendar();

function inp(birth: string, ref = birth, over: Partial<TimelineInput> = {}): TimelineInput {
  return {
    birthDate: parseDate(birth),
    referenceDate: parseDate(ref),
    monthsAhead: 156,
    includePast: true,
    holidays: cal,
    ...over,
  };
}

function pregnant(due: string, ref: string, over: Partial<TimelineInput> = {}): TimelineInput {
  return inp(due, ref, { mode: "pregnant", dueDate: parseDate(due), ...over });
}

function span(it: TimelineItem): string {
  return `${formatDate(it.start)}~${formatDate(it.end ?? it.start)}`;
}

function all(it: TimelineItem): string {
  return [it.title, ...it.notes].join("\n");
}

const text = (r: { content: { type: string; text?: string }[] }): string => r.content[0]!.text ?? "";

describe("benefit version selection", () => {
  it("selectVersion picks by range with boundaries", () => {
    const fx = [
      { effective_from: "2026-01-01", effective_to: "2026-12-31" },
      { effective_from: "2028-01-01", effective_to: "2028-12-31" },
    ];
    const at = (s: string): CivilDate => parseDate(s);
    expect(selectVersion(fx, at("2025-12-31"))).toBeUndefined();
    expect(selectVersion(fx, at("2026-01-01"))).toEqual({ version: fx[0], fallback: false });
    expect(selectVersion(fx, at("2026-12-31"))).toEqual({ version: fx[0], fallback: false });
    expect(selectVersion(fx, at("2027-01-01"))).toEqual({ version: fx[0], fallback: true });
    expect(selectVersion(fx, at("2027-12-31"))).toEqual({ version: fx[0], fallback: true });
    expect(selectVersion(fx, at("2028-01-01"))).toEqual({ version: fx[1], fallback: false });
    expect(selectVersion(fx, at("2029-01-01"))).toEqual({ version: fx[1], fallback: true });
    expect(fallbackNote(fx[0]!)).toContain("표 미등록, 직전 버전 기준");
  });

  it("fixture table falls back to prior version", () => {
    const real = loadData("benefits");
    const fixture = {
      select_by: "reference_date" as const,
      versions: [{ ...real.parent_allowance.versions[0]!, effective_to: "2026-06-30" }],
    };
    const items = parentAllowanceItems(inp("2026-01-31", "2026-08-01"), fixture);
    expect(items).toHaveLength(2);
    for (const it of items) expect(all(it)).toContain("직전 버전 기준");

    const earliest = parentAllowanceItems(inp("2026-01-31", "2025-12-31"));
    for (const it of earliest) expect(all(it)).toContain("가장 이른 등록 버전");
  });

  it("tool output shows medical cost only in pregnant mode", async () => {
    const ctx = createTestContext();
    const pregnantText = text(
      await runTool(getTimelineTool, { due_date: "2027-02-10", reference_date: "2026-10-28" }, ctx),
    );
    expect(pregnantText).toContain("| 임신·출산 진료비 지원");
    const bornText = text(
      await runTool(getTimelineTool, { birth_date: "2026-05-28", reference_date: "2026-10-28" }, ctx),
    );
    expect(bornText).not.toContain("임신·출산 진료비");
  });
});

describe("benefit amount periods", () => {
  it("parent and child allowance periods", () => {
    const parents = parentAllowanceItems(inp("2026-01-31", "2026-02-01"));
    const age0 = parents.find((i) => i.id === "parent-allowance-age0")!;
    const age1 = parents.find((i) => i.id === "parent-allowance-age1")!;
    expect(span(age0)).toBe("2026-01-31~2027-01-30");
    expect(age0.title).toContain("월 100만원");
    expect(span(age1)).toBe("2027-01-31~2028-01-30");
    expect(age1.title).toContain("월 50만원");

    const [child] = childAllowanceItems(inp("2026-01-31", "2026-02-01"));
    expect(child).toBeDefined();
    expect(span(child!)).toBe("2026-01-31~2035-01-30");
    expect(child!.title).toContain("월 10만원");
    expect(child!.title).toContain("만 9세 미만");
    expect(child!.notes.join("\n")).toContain("지자체 확인");
    expect(child!.notes.join("\n")).toContain("확대 예정");
    expect(child!.notes.join("\n")).toContain("2027년부터 만 10세 미만");

    const [later] = childAllowanceItems(inp("2026-01-31", "2027-03-01"));
    expect(later!.end && formatDate(later!.end)).toBe("2036-01-30");
    expect(later!.title).toContain("만 10세 미만");
  });

  it("first meeting deadline and amounts", () => {
    const [none] = firstMeetingItems(inp("2026-03-10"));
    expect(none).toBeDefined();
    expect(none!.end && formatDate(none!.end)).toBe("2028-03-09");
    expect(none!.title).toContain("200만원");
    expect(none!.title).toContain("300만원");

    const [first] = firstMeetingItems(inp("2026-03-10", "2026-03-10", { birthOrder: 1 }));
    expect(all(first!)).toContain("200만원");
    expect(all(first!)).not.toContain("300만원");

    const [second] = firstMeetingItems(inp("2026-03-10", "2026-03-10", { birthOrder: 2 }));
    expect(all(second!)).toContain("300만원");
    expect(all(second!)).not.toContain("200만원");

    const notes = none!.notes.join("\n");
    expect(notes).toContain("사용기한: 확인 필요");
    expect(notes.includes("2028년 공휴일 정보 없음")).toBe(!loadData("holidays").covers_years.includes(2028));

    const [outside] = firstMeetingItems(inp("2023-12-31"));
    expect(outside).toBeDefined();
    expect(outside!.title).toContain("표 미등록");
    expect(outside!.end).toBeUndefined();
    expect(all(outside!)).not.toContain("만원");
  });

  it("pregnancy medical cost", () => {
    const [one] = medicalCostItems(pregnant("2027-02-10", "2026-10-28", { fetusCount: 1 }));
    expect(one).toBeDefined();
    expect(one!.title).toContain("100만원");

    const [two] = medicalCostItems(pregnant("2027-02-10", "2026-10-28", { fetusCount: 2 }));
    expect(two!.title).toContain("태아당 100만원");
    expect(two!.title).toContain("합계 200만원");
    expect(two!.notes.join("\n")).toContain("사용기한: 확인 필요");
    expect(two!.notes.join("\n")).toContain("자료별 표기 상이");

    expect(medicalCostItems(inp("2026-05-28", "2026-10-28"))).toEqual([]);
  });

  it("deadline memos keep values", () => {
    const items = benefitDeadlineRule(inp("2026-01-31"));
    const parent = items.find((i) => i.id === "parent-allowance")!;
    const child = items.find((i) => i.id === "child-allowance")!;
    expect(parent.notes.join("\n")).toContain("0세 월 100만원");
    expect(child.notes.join("\n")).toContain("월 10만원");
  });

  it("no amount or age constants in benefit rule sources", () => {
    for (const rel of ["../src/timeline/rules/benefits.ts", "../src/timeline/rules/benefit-deadlines.ts"]) {
      const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
      expect(src).not.toMatch(/\d+만원/);
      expect(src).not.toMatch(/\b\d{5,}\b/);
      expect(src).not.toMatch(/만 \d+세/);
    }
  });
});
