import { describe, expect, it } from "vitest";
import { formatDate, parseDate } from "../src/date/civil-date.js";
import { bundledCalendar } from "../src/date/holiday-calendar.js";
import { runTool } from "../src/core/pipeline.js";
import { getTimelineTool } from "../src/tools/get-timeline.js";
import type { TimelineInput, TimelineItem } from "../src/timeline/types.js";
import {
  maternityLeaveItems,
  parentalLeaveItems,
  spouseLeaveItems,
} from "../src/timeline/rules/leave.js";
import { createTestContext } from "./helpers/context.js";

const cal = bundledCalendar();
const REF = "2026-10-28";

function born(b: string): TimelineInput {
  return {
    birthDate: parseDate(b),
    referenceDate: parseDate(b),
    monthsAhead: 156,
    includePast: true,
    holidays: cal,
  };
}

function preg(due: string): TimelineInput {
  return { ...born(due), mode: "pregnant", dueDate: parseDate(due) };
}

function span(it: TimelineItem): string {
  return `${formatDate(it.start)}~${formatDate(it.end ?? it.start)}`;
}

function all(it: TimelineItem): string {
  return [it.title, ...it.notes].join("\n");
}

const text = (r: { content: { type: string; text?: string }[] }): string => r.content[0]!.text ?? "";

describe("timeline leave rules", () => {
  it("spouse leave branches", () => {
    const oldOnly = spouseLeaveItems(born("2026-05-20"));
    expect(oldOnly).toHaveLength(1);
    expect(span(oldOnly[0]!)).toBe("2026-05-20~2026-09-17");
    expect(all(oldOnly[0]!)).not.toContain("유급 20일");
    expect(all(oldOnly[0]!)).not.toContain("3회");

    const boundary = spouseLeaveItems(born("2026-05-21"));
    expect(span(boundary[0]!)).toBe("2026-09-18~2026-09-18");
    expect(boundary[0]!.title).toContain("유급 20일");
    expect(boundary[0]!.title).toContain("3회 분할");

    const shifted = spouseLeaveItems(born("2026-08-01"));
    expect(span(shifted[0]!)).toBe("2026-09-18~2026-11-29");
    expect(all(shifted[0]!)).toContain("경과조치 없음");

    const afterShift = spouseLeaveItems(born("2026-10-01"));
    expect(span(afterShift[0]!)).toBe("2026-10-01~2027-01-29");
    expect(all(afterShift[0]!)).not.toContain("경과조치");
    expect(all(afterShift[0]!)).toContain("50일 전부터 가능");

    const pregOld = spouseLeaveItems(preg("2026-05-01"));
    expect(pregOld[0]!.title).toContain("개정 전 규정");
    expect(all(pregOld[0]!)).not.toContain("유급 20일");

    const pregShift = spouseLeaveItems(preg("2026-11-01"));
    expect(span(pregShift[0]!)).toBe("2026-09-18~2027-03-01");
    expect(all(pregShift[0]!)).toContain("경과조치 없음");

    const pregNew = spouseLeaveItems(preg("2027-03-01"));
    expect(span(pregNew[0]!)).toBe("2027-01-10~2027-06-29");
    expect(all(pregNew[0]!)).not.toContain("경과조치");
    expect(all(pregNew[0]!)).not.toContain("50일 전부터 가능");

    for (const it of [...boundary, ...afterShift, ...pregShift, ...pregNew]) {
      expect(all(it)).toContain("신청 절차");
      expect(all(it)).toContain("확인 필요");
    }
  });

  it("maternity leave overview", () => {
    const single = maternityLeaveItems(born("2026-05-28"));
    expect(single).toHaveLength(1);
    const s = all(single[0]!);
    expect(s).toContain("90일");
    expect(s).toContain("출산 후 45일 이상");
    expect(s).toContain("최초 60일 유급");
    expect(s).toContain("2026-10-08");
    expect(single[0]!.end).toBeUndefined();
    expect(single[0]!.provenance.verified).not.toBe("full");

    const multiple = maternityLeaveItems({ ...born("2026-05-28"), fetusCount: 2 });
    const m = all(multiple[0]!);
    expect(m).toContain("120일");
    expect(m).toContain("출산 후 60일 이상");
    expect(m).toContain("최초 75일 유급");
    expect(m).toContain("2026-10-08");
    expect(multiple[0]!.end).toBeUndefined();
    expect(multiple[0]!.provenance.verified).not.toBe("full");
  });

  it("parental leave overview", () => {
    const items = parentalLeaveItems(born("2026-01-31"));
    expect(items).toHaveLength(1);
    const it = items[0]!;
    expect(span(it)).toBe("2026-01-31~2035-01-30");
    const joined = all(it);
    expect(joined).toContain("초등학교 2학년 이하");
    expect(joined).toContain("분할 사용 횟수: 확인 필요");
    expect(joined).toContain("급여 상한: 확인 필요");
    for (const n of it.notes.filter((x) => x.includes("만원"))) {
      expect(n).toContain("참고값");
      expect(n).toContain("법적 효력 없음");
    }
    expect(it.provenance.verified).not.toBe("full");
    expect(joined).toContain("제19조");
  });

  it("tool shows new-law spouse leave", async () => {
    const r = await runTool(
      getTimelineTool,
      { birth_date: "2026-10-01", reference_date: REF },
      createTestContext(),
    );
    expect(text(r)).toContain("[진행 중] 2026-10-01 ~ 2027-01-29 | 배우자 출산휴가");
  });
});
