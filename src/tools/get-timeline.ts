import { z } from "zod";
import type { ToolContext } from "../core/context.js";
import { ToolError } from "../core/errors.js";
import { loadData } from "../data-store/load.js";
import { compare, daysBetween, parseDate, todayKst, type CivilDate } from "../date/civil-date.js";
import { bundledCalendar } from "../date/holiday-calendar.js";
import { buildTimeline } from "../timeline/engine.js";
import { renderTimeline } from "../timeline/render.js";
import type { TimelineMode } from "../timeline/types.js";
import type { ToolDef, ToolOutput } from "./registry.js";
import { boolField, dateField, intField, keywordField } from "./shared/schema.js";

const MAX_DUE_AHEAD_DAYS = 300;
const MAX_DUE_PAST_DAYS = 90;
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

function buildOutput(
  args: z.output<typeof schema>,
  referenceDate: CivilDate,
  mode: TimelineMode,
  birthDate: CivilDate,
  dueDate: CivilDate | undefined,
): ToolOutput {
  const monthsAhead = args.months_ahead ?? 12;
  const includePast = args.include_past ?? false;
  const holidays = bundledCalendar({ referenceDate });
  const result = buildTimeline({
    mode,
    birthDate,
    dueDate,
    region: args.region,
    birthOrder: args.birth_order,
    fetusCount: args.fetus_count,
    referenceDate,
    monthsAhead,
    includePast,
    holidays,
  });
  return renderTimeline(result, {
    mode,
    birthDate,
    referenceDate,
    monthsAhead,
    includePast,
    holidaySource: `번들(생성일 ${loadData("holidays").generated_at})`,
  });
}

async function handler(args: z.output<typeof schema>, ctx: ToolContext): Promise<ToolOutput> {
  const hasDue = args.due_date !== undefined;
  const hasBirth = args.birth_date !== undefined;
  if (hasDue === hasBirth) {
    throw new ToolError(
      "BAD_INPUT",
      hasDue
        ? "due_date(출산예정일)와 birth_date(생년월일)를 함께 줄 수 없습니다. 둘 중 하나만 주세요."
        : "due_date(출산예정일) 또는 birth_date(생년월일) 중 하나가 필요합니다.",
      {
        actions: [
          "임신 중이면 출산예정일만 주세요(예: due_date: \"2027-02-10\").",
          "출산 후면 생년월일만 주세요(예: birth_date: \"2026-01-31\").",
        ],
      },
    );
  }
  const referenceDate = args.reference_date !== undefined ? parseDate(args.reference_date) : todayKst(ctx.clock);

  if (args.due_date !== undefined) {
    const dueDate = parseDate(args.due_date);
    const ahead = daysBetween(referenceDate, dueDate);
    if (ahead > MAX_DUE_AHEAD_DAYS || ahead < -MAX_DUE_PAST_DAYS) {
      throw new ToolError(
        "BAD_INPUT",
        `due_date(출산예정일)는 기준일 ${MAX_DUE_PAST_DAYS}일 전부터 ${MAX_DUE_AHEAD_DAYS}일 후까지만 받습니다. 출산 후라면 birth_date(생년월일)를 사용하세요.`,
        {
          actions: [
            "출산 후면 birth_date로 다시 호출하세요(예: birth_date: \"2026-10-20\").",
            "예정일을 확인해 다시 주세요(예: due_date: \"2027-02-10\").",
          ],
        },
      );
    }
    return buildOutput(args, referenceDate, "pregnant", dueDate, dueDate);
  }

  const birthDate = parseDate(args.birth_date as string);
  if (compare(referenceDate, birthDate) < 0) {
    throw new ToolError(
      "BAD_INPUT",
      "birth_date(생년월일)가 reference_date(기준일)보다 뒤입니다. 아직 태어나지 않았다면(임신 중) due_date(출산예정일)를 사용하세요.",
      {
        actions: [
          "임신 중이면 due_date로 다시 호출하세요(예: due_date: \"2027-02-10\").",
          "기준일을 바꾸려면 생년월일 이후 날짜를 주세요(예: reference_date: \"2026-02-01\").",
        ],
      },
    );
  }
  return buildOutput(args, referenceDate, "born", birthDate, undefined);
}

const def: ToolDef<typeof schema> = {
  name: "get_timeline",
  title: "육아 타임라인(임신 중·출산 후 기한·검진·예방접종 일정)",
  description:
    "아기 생년월일로 출생신고 기한, 부모급여·아동수당 신청 기한(60일 소급 기준), 영유아 건강검진 8회와 구강검진 4회 기간, 국가예방접종 13종의 차수별 권장 시기와 인플루엔자 절기 접종 기간을 날짜순으로 계산합니다. 각 항목에 기간, 성격(법정 의무/권장/지원 신청), 진행 상태, 출처와 검증 상태를 표시합니다. 최소 접종 간격·지연접종은 반영하지 않습니다. API 키와 네트워크 없이 동작하며 결과는 참고용입니다. 임신 중이면 birth_date 대신 출산예정일(due_date)로 산전검진 구간·임신부 인플루엔자와 출생 후 일정(예정일 기준)을 계산합니다.",
  schema,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  maxChars: 20000,
  handler,
};

export const getTimelineTool = def as unknown as ToolDef;
