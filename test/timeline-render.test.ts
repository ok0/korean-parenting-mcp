import { describe, expect, it } from "vitest";
import { parseDate } from "../src/date/civil-date.js";
import { bundledCalendar, createCalendar } from "../src/date/holiday-calendar.js";
import { buildTimeline } from "../src/timeline/engine.js";
import { renderItemLine, renderTimeline, type TimelineView } from "../src/timeline/render.js";
import type { TimelineInput, TimelineItem, TimelineResult } from "../src/timeline/types.js";
import {
  DISCLAIMER_MEDICAL_LEGAL,
  ESTIMATED_NOTE,
  NOTICE_UNOFFICIAL,
  NOTICE_VACCINATION_SCOPE,
} from "../src/tools/shared/format.js";

const HOLIDAY_SOURCE = "번들(생성일 2026-10-28)";

const vac: TimelineItem = {
  id: "vac-x-1",
  category: "접종",
  title: "테스트 백신 1차 (2개월)",
  nature: "권장",
  start: parseDate("2026-03-31"),
  end: parseDate("2026-04-29"),
  status: "예정",
  notes: [],
  provenance: { basis_ids: ["health-checkup-standard"], as_of: "2026-10-28", verified: "partial" },
};

const view: TimelineView = {
  birthDate: parseDate("2026-01-31"),
  referenceDate: parseDate("2026-02-01"),
  monthsAhead: 12,
  includePast: false,
  holidaySource: HOLIDAY_SOURCE,
};

const res = (items: TimelineItem[], notices: string[] = []): TimelineResult => ({
  items,
  hiddenPast: 0,
  hiddenFuture: 0,
  warnings: [],
  basisIds: ["health-checkup-standard"],
  notices,
});

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
  const result = buildTimeline(input);
  return { ...renderTimeline(result, view), result };
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
    const out = run("2005-01-01", "2026-01-01");
    expect(out.body).toContain("표시할 항목이 없습니다");
    expect(out.body).toContain("include_past");
    expect(out.body).toContain(`지난 항목 ${out.result.hiddenPast}개 숨김`);
    expect(out.result.hiddenPast).toBeGreaterThan(0);
    expect(out.result.items.length).toBe(0);
    expect(out.footer ?? "").not.toContain(NOTICE_VACCINATION_SCOPE);
  });

  it("future hidden count", () => {
    const out = run("2026-01-31", "2026-02-01", 1);
    expect(out.body).toContain(`먼 미래 항목 ${out.result.hiddenFuture}개 숨김`);
    expect(out.result.hiddenFuture).toBeGreaterThan(0);
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
    expect(footer).toContain("2026년 국가예방접종 지침");
    expect(footer).toContain("KDCA 게시물 309683");
    expect(footer).toContain("개정 2026-10-02");
    expect(footer).toContain("국가예방접종 사업 소개(인플루엔자)");
    expect(footer).toContain("개정 2026-08-25");
    expect(footer).toContain("표준예방접종일정표(2026, 어린이)");
    expect(footer.split(NOTICE_VACCINATION_SCOPE).length - 1).toBe(1);
    expect(footer).not.toContain("mch-act-rule-annex1");
  });

  it("warnings appear in footer", () => {
    const footer = run("2026-01-31", "2026-02-01", 156, true, createCalendar({}, ["경고X"])).footer ?? "";
    expect(footer).toContain("주의:\n- 경고X");
  });

  it("vaccination footer line appears once only when a vaccine item is shown", () => {
    const out = renderTimeline(res([vac]), view);
    expect((out.footer ?? "").split(NOTICE_VACCINATION_SCOPE).length - 1).toBe(1);
    expect(out.body).not.toContain(NOTICE_VACCINATION_SCOPE);
    expect(renderTimeline(res([{ ...vac, category: "검진" }]), view).footer).not.toContain(NOTICE_VACCINATION_SCOPE);
    expect(renderTimeline(res([]), view).footer).not.toContain(NOTICE_VACCINATION_SCOPE);
  });

  it("notices render after summary", () => {
    const body = renderTimeline(res([], ["안내X"]), view).body;
    expect(body).toContain("안내: 안내X");
    expect(body).toContain("표시할 항목이 없습니다");
    const idx = body.indexOf("안내: 안내X");
    expect(idx).toBeGreaterThan(body.indexOf("상태 요약:"));
    expect(idx).toBeLessThan(body.indexOf("표시할 항목이 없습니다"));
  });

  it("estimated items carry the estimate note", () => {
    expect(renderItemLine({ ...vac, estimated: true })).toContain(ESTIMATED_NOTE);
    expect(renderItemLine(vac)).not.toContain(ESTIMATED_NOTE);
  });
});
