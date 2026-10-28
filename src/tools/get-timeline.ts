import { z } from "zod";
import type { ToolContext } from "../core/context.js";
import { ToolError } from "../core/errors.js";
import { loadData } from "../data-store/load.js";
import { compare, parseDate, todayKst } from "../date/civil-date.js";
import { bundledCalendar } from "../date/holiday-calendar.js";
import { buildTimeline } from "../timeline/engine.js";
import { renderTimeline } from "../timeline/render.js";
import type { ToolDef, ToolOutput } from "./registry.js";
import { boolField, dateField, intField } from "./shared/schema.js";

const schema = z.object({
  birth_date: dateField({
    purpose: "아기의 생년월일. 출생 후 일정(신고·신청 기한, 검진 기간) 계산 기준입니다.",
    format: "YYYY-MM-DD, YYYY.MM.DD, YYYYMMDD 중 하나",
    example: "2026-01-31",
  }),
  reference_date: dateField({
    purpose: "진행 상태(지난/진행 중/임박/예정)를 판정할 기준일. 생략하면 오늘(한국 시간)입니다.",
    format: "YYYY-MM-DD, YYYY.MM.DD, YYYYMMDD 중 하나, 생년월일 이후",
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
});

async function handler(args: z.output<typeof schema>, ctx: ToolContext): Promise<ToolOutput> {
  const birthDate = parseDate(args.birth_date);
  const referenceDate = args.reference_date !== undefined ? parseDate(args.reference_date) : todayKst(ctx.clock);
  if (compare(referenceDate, birthDate) < 0) {
    throw new ToolError(
      "BAD_INPUT",
      "reference_date(기준일)가 birth_date(생년월일)보다 앞섭니다. 이 도구는 출산 후 기준으로만 지원합니다(임신 중 기능은 추후 제공 예정).",
      {
        actions: [
          "reference_date를 생년월일 이후 날짜로 주거나 생략하세요(예: reference_date: \"2026-02-01\").",
          "출산 전이라면 출산 후 실제 생년월일로 다시 호출하세요(예: birth_date: \"2026-01-31\").",
        ],
      },
    );
  }
  const monthsAhead = args.months_ahead ?? 12;
  const includePast = args.include_past ?? false;
  const holidays = bundledCalendar({ referenceDate });
  const result = buildTimeline({ birthDate, referenceDate, monthsAhead, includePast, holidays });
  return renderTimeline(result, {
    birthDate,
    referenceDate,
    monthsAhead,
    includePast,
    holidaySource: `번들(생성일 ${loadData("holidays").generated_at})`,
  });
}

const def: ToolDef<typeof schema> = {
  name: "get_timeline",
  title: "육아 타임라인(출생 후 기한·검진 일정)",
  description:
    "아기 생년월일로 출생신고 기한, 부모급여·아동수당 신청 기한(60일 소급 기준), 영유아 건강검진 8회와 구강검진 4회 기간을 날짜순으로 계산합니다. 각 항목에 기간, 성격(법정 의무/권장/지원 신청), 진행 상태, 출처와 검증 상태를 표시합니다. API 키와 네트워크 없이 동작하며 결과는 참고용입니다.",
  schema,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  maxChars: 12000,
  handler,
};

export const getTimelineTool = def as unknown as ToolDef;
