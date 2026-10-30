import { z } from "zod";
import type { ToolContext } from "../core/context.js";
import { loadData } from "../data-store/load.js";
import { todayKst } from "../date/civil-date.js";
import { bundledCalendar, holidaySourceLabel, trackCalendarYears } from "../date/holiday-calendar.js";
import { resolveHolidayCalendar } from "../clients/holiday-resolve.js";
import { buildTimeline } from "../timeline/engine.js";
import { localGuidance } from "../timeline/rules/local.js";
import { resolveTimelineInput, type ResolvedTimelineInput } from "../timeline/input.js";
import { checkRevisions } from "../provenance/revision-check.js";
import { footerBasisIds, renderTimeline } from "../timeline/render.js";
import type { TimelineInput } from "../timeline/types.js";
import type { ToolDef, ToolOutput } from "./registry.js";
import { boolField, dateField, intField, keywordField } from "./shared/schema.js";

const DATE_FORMAT = "YYYY-MM-DD, YYYY.MM.DD, YYYYMMDD 중 하나";

const schema = z.object({
  due_date: dateField({
    purpose:
      "출산예정일. 임신 중이면 이 값을 주세요(birth_date와 함께 주지 않음). 산전검진·임신부 접종과 출생 후 일정(예정일 기준)을 계산합니다.",
    format: `${DATE_FORMAT}, 기준일 90일 전~300일 후`,
    example: "2027-02-10",
  }).optional(),
  birth_date: dateField({
    purpose:
      "아기의 생년월일. 출산 후면 이 값을 주세요(due_date와 함께 주지 않음). 출생 후 일정(신고·신청 기한, 검진·예방접종, 지원금·휴가) 계산 기준입니다.",
    format: `${DATE_FORMAT}, 기준일 이전`,
    example: "2026-01-31",
  }).optional(),
  region: keywordField(
    {
      purpose: "거주 지역명(시·군·구). 지역·기관별 확인처 문구에만 쓰며 날짜·금액 계산에는 영향이 없습니다.",
      format: "1~40자 문자열(검증·정규화하지 않음)",
      example: "성동구",
    },
    { max: 40 },
  ).optional(),
  reference_date: dateField({
    purpose: "진행 상태(지난/진행 중/임박/예정)를 판정할 기준일. 생략하면 오늘(한국 시간)입니다.",
    format: DATE_FORMAT,
    example: "2026-02-01",
  }).optional(),
  months_ahead: intField(
    {
      purpose: "기준일부터 몇 개월 뒤까지 시작하는 항목을 보여줄지.",
      format: "1~156 정수(숫자 또는 숫자 문자열), 기본 12",
      example: "24",
    },
    { min: 1, max: 156 },
  ).optional(),
  include_past: boolField({
    purpose: "이미 지난 항목도 표시할지.",
    format: "true 또는 false(문자열 허용), 기본 false",
    example: "true",
  }).optional(),
  birth_order: intField(
    {
      purpose: "이번 아이가 몇째인지. 첫만남이용권 금액(첫째/둘째 이상) 표시에 씁니다. 생략하면 두 금액을 함께 표시합니다.",
      format: "1~10 정수(숫자 또는 숫자 문자열)",
      example: "1",
    },
    { min: 1, max: 10 },
  ).optional(),
  fetus_count: intField(
    {
      purpose: "태아(출생 아이) 수. 다태아 출산전후휴가·임신·출산 진료비 계산에 씁니다.",
      format: "1~4 정수(숫자 또는 숫자 문자열), 기본 1",
      example: "2",
    },
    { min: 1, max: 4 },
  ).optional(),
});

function sameMembers(a: readonly string[], b: readonly string[]): boolean {
  const setA = new Set(a);
  const setB = new Set(b);
  return setA.size === setB.size && [...setA].every((id) => setB.has(id));
}

async function buildOutput(input: ResolvedTimelineInput, ctx: ToolContext): Promise<ToolOutput> {
  const { mode, birthDate, referenceDate, monthsAhead, includePast } = input;
  const local = localGuidance({ mode, region: input.region });
  const base: Omit<TimelineInput, "holidays"> = { ...input };
  const probe = trackCalendarYears(bundledCalendar({ referenceDate }));
  const probeIds = footerBasisIds(buildTimeline({ ...base, holidays: probe.calendar }), local);
  const [holidays, probeRevisions] = await Promise.all([
    resolveHolidayCalendar(probe.years(), ctx, { referenceDate }),
    checkRevisions(probeIds, ctx),
  ]);
  const result = buildTimeline({ ...base, holidays });
  const ids = footerBasisIds(result, local);
  const revisions = sameMembers(ids, probeIds) ? probeRevisions : await checkRevisions(ids, ctx);
  return renderTimeline(result, {
    mode,
    birthDate,
    referenceDate,
    monthsAhead,
    includePast,
    holidaySource: holidaySourceLabel(holidays, loadData("holidays").generated_at),
  }, local, revisions);
}

async function handler(args: z.output<typeof schema>, ctx: ToolContext): Promise<ToolOutput> {
  return buildOutput(resolveTimelineInput(args, todayKst(ctx.clock)), ctx);
}

const def: ToolDef<typeof schema> = {
  name: "get_timeline",
  title: "육아 타임라인(임신 중·출산 후 기한·검진·예방접종·지원금·휴가 일정)",
  description:
    "임신 중이면 출산예정일(due_date), 출산 후면 아기 생년월일(birth_date) 중 하나로 일정을 날짜순으로 계산합니다. 출생신고 기한, 부모급여·아동수당 신청 기한과 지급 구간, 첫만남이용권 신청 기한, 배우자 출산휴가·출산전후휴가·육아휴직 개요, 영유아 건강검진 8회와 구강검진 4회, 국가예방접종 13종과 인플루엔자 절기 접종을 포함하고, 임신 중에는 산전검진 구간·임신부 인플루엔자·임신·출산 진료비를 더합니다. 금액·연령은 연도별 표 기준이며 임신 중 출생 후 항목은 예정일 기준입니다. 지역·기관별 확인 사항(보건소·입소대기·지자체 지원)을 함께 안내합니다. 각 항목에 기간, 성격(법정 의무/권장/지원 신청/안내), 진행 상태, 출처와 검증 상태를 표시합니다. 최소 접종 간격·지연접종은 반영하지 않습니다. API 키 없이 동작하며, LAW_OC가 설정되어 있으면 근거 문서의 개정 여부를 법제처에서 확인해 함께 표시합니다. 결과는 참고용입니다.",
  schema,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  maxChars: 20000,
  handler,
};

export const getTimelineTool = def as unknown as ToolDef;
