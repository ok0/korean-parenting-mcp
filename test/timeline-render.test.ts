import { describe, expect, it } from "vitest";
import { parseDate } from "../src/date/civil-date.js";
import { bundledCalendar, createCalendar } from "../src/date/holiday-calendar.js";
import { buildTimeline } from "../src/timeline/engine.js";
import { renderTimeline, type TimelineView } from "../src/timeline/render.js";
import type { TimelineInput } from "../src/timeline/types.js";
import { DISCLAIMER_MEDICAL_LEGAL, NOTICE_UNOFFICIAL } from "../src/tools/shared/format.js";

const HOLIDAY_SOURCE = "번들(생성일 2026-10-28)";

function run(
  birth: string,
  ref: string,
  monthsAhead = 12,
  includePast = false,
  holidays = bundledCalendar(),
) {
  const input: TimelineInput = {
    birthDate: parseDate(birth),
    referenceDate: parseDate(ref),
    monthsAhead,
    includePast,
    holidays,
  };
  const view: TimelineView = {
    birthDate: input.birthDate,
    referenceDate: input.referenceDate,
    monthsAhead,
    includePast,
    holidaySource: HOLIDAY_SOURCE,
  };
  return renderTimeline(buildTimeline(input), view);
}

describe("timeline render", () => {
  it("item line shows period, nature, source, as_of and verification", () => {
    const out = run("2026-01-31", "2026-02-01", 156, true);
    expect(out.body).toContain(
      "[진행 중] 2026-01-31 ~ 2026-03-03 | 출생신고 기한 | 법정 의무 | 출처 family-registration-act, civil-act | 기준일 2026-10-28 | 부분 검증",
    );
    expect(out.body).toContain("원래 말일 2026-02-28");
    expect(out.body.match(/영유아 건강검진 \d차/g)?.length).toBe(8);
    expect(out.body.match(/영유아 구강검진 \d차/g)?.length).toBe(4);
  });

  it("zero items gives widening hint", () => {
    const out = run("2019-01-01", "2026-01-01");
    expect(out.body).toContain("표시할 항목이 없습니다");
    expect(out.body).toContain("include_past");
    expect(out.body).toContain("지난 항목 15개 숨김");
  });

  it("future hidden count", () => {
    const out = run("2026-01-31", "2026-02-01", 1);
    expect(out.body).toContain("먼 미래 항목 11개 숨김");
  });

  it("footer carries basis docs, holiday source, disclaimers", () => {
    const footer = run("2026-01-31", "2026-02-01", 156, true).footer ?? "";
    expect(footer.startsWith("---\n")).toBe(true);
    expect(footer).toContain("가족관계의 등록 등에 관한 법률");
    expect(footer).toContain("법률 제21857호");
    expect(footer).toContain("보건복지부고시 제2026-6호");
    expect(footer).toContain("개정 여부 자동 확인은 아직 제공하지 않");
    expect(footer).toContain("공휴일: 번들(생성일 2026-10-28)");
    expect(footer).toContain(DISCLAIMER_MEDICAL_LEGAL);
    expect(footer).toContain(NOTICE_UNOFFICIAL);
  });

  it("warnings appear in footer", () => {
    const footer = run("2026-01-31", "2026-02-01", 156, true, createCalendar({}, ["경고X"])).footer ?? "";
    expect(footer).toContain("주의:\n- 경고X");
  });
});
