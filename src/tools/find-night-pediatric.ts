import { z } from "zod";
import { callDataGoKr, type DataGoKrResult } from "../clients/data-go-kr.js";
import { NEMC_DEPT_PEDIATRICS, NEMC_SEND_QT, SPECS } from "../clients/data-go-kr-specs.js";
import { formatKstMinute, resolveHolidayCalendar } from "../clients/holiday-resolve.js";
import type { ToolContext } from "../core/context.js";
import { ToolError } from "../core/errors.js";
import { settleWithin } from "../core/deadline.js";
import { loadData } from "../data-store/load.js";
import { addDays, formatDate, type CivilDate } from "../date/civil-date.js";
import { holidaySourceLabel, type HolidayCalendar } from "../date/holiday-calendar.js";
import {
  type Clinic,
  type DaySlot,
  formatHhmm,
  judgeOpen,
  type Judgement,
  kstMoment,
  mergeClinics,
  parseNowInput,
  SLOT_LABEL,
  sortJudged,
  weekdaySlot,
} from "../clinic/night-hours.js";
import { normalizeRegion, nemcQuery } from "../region/normalize.js";
import type { ToolDef, ToolOutput } from "./registry.js";
import { NOTICE_SOURCE, composeFooter, partialNotice, sourceFooter, summarizeList, zeroResultHint } from "./shared/format.js";
import { describeField, intField, regionField } from "./shared/schema.js";

const MOON_ROWS = 50;
const PEDS_ROWS = 100;
const DEFAULT_LIMIT = 5;
const LABEL_MOON = "달빛어린이병원 목록";
const LABEL_PEDS = "소아청소년과 목록";
const NOTICE_CALL_AHEAD = "운영시간은 변동될 수 있으니 방문 전 전화로 확인하세요.";
const NOTICE_EMERGENCY = "응급 상황이면 119에 전화하거나 가까운 응급실을 이용하세요.";
const NOTICE_KIND =
  "구분: [진료과목에 소아청소년과 포함]은 소아청소년과를 진료과목으로 등록한 다른 전문과 병·의원입니다(아이 진료 여부는 전화로 확인).";
const DISCLAIMER_CLINIC =
  "의료 면책: 공공데이터의 기관·운영시간 정보를 옮긴 참고 정보이며 진단·처방이나 병원 선택 판단을 하지 않습니다. 증상 판단은 의료진에게 받으세요.";
const ERROR_PRIORITY: string[] = [
  "NOT_APPROVED",
  "KEY_INVALID",
  "KEY_EXPIRED",
  "DAILY_LIMIT",
  "RATE_LIMIT",
  "UPSTREAM",
  "TIMEOUT",
  "INTERNAL",
];

const schema = z.object({
  region: regionField({
    purpose: "야간·휴일 소아 진료기관을 찾을 지역(시군구 단위, 동 단위 불가).",
    format: "시도·시군구 이름 1~40자, 시도 생략 가능",
    example: "성동구, 수원시 영통구",
  }),
  now: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .refine((s) => parseNowInput(s) !== undefined, {
      message: "ISO 일시 형식이어야 합니다(예: 2026-10-28T21:30 또는 2026-10-28T21:30:00+09:00)",
    })
    .describe(
      describeField({
        purpose: "진료 여부를 판정할 기준 시각. 생략하면 현재 시각.",
        format: "ISO 8601 일시(YYYY-MM-DDTHH:MM[:SS][±HH:MM]), 시간대가 없으면 한국 시간",
        example: "2026-10-28T21:30",
      }),
    )
    .optional(),
  limit: intField(
    {
      purpose: "요약할 기관 수(지금 진료 중인 곳 우선).",
      format: "1~10 정수(숫자 문자열 허용), 기본 5",
      example: "5",
    },
    { min: 1, max: 10 },
  ).optional(),
});

interface PartialFailure {
  label: string;
  reason: string;
  action?: string;
}

function regionGuidance(message: string, candidates: { sido: string; sigungu?: string }[]): ToolOutput {
  let body = `지역을 확인해 주세요: ${message}`;
  if (candidates.length > 0) {
    body +=
      "\n후보:\n" +
      candidates.map((c) => `- ${c.sido} ${c.sigungu ?? ""}`.trim()).join("\n") +
      "\n후보 중 하나를 region으로 다시 조회하세요.";
  }
  return { body, footer: composeFooter([NOTICE_SOURCE]) };
}

function slotOf(cal: HolidayCalendar, date: CivilDate): { slot: DaySlot; missingYear: boolean } {
  if (cal.coverage(date.y) === "none") return { slot: weekdaySlot(date), missingYear: true };
  return { slot: cal.isPublicHoliday(date) ? 8 : weekdaySlot(date), missingYear: false };
}

function toToolError(e: unknown): ToolError {
  return e instanceof ToolError ? e : new ToolError("UPSTREAM", "외부 응답을 처리하지 못했습니다");
}

function pickError(a: ToolError, b: ToolError): ToolError {
  const rank = (e: ToolError): number => {
    const i = ERROR_PRIORITY.indexOf(e.kind);
    return i === -1 ? ERROR_PRIORITY.length : i;
  };
  return rank(b) < rank(a) ? b : a;
}

function failureOf(label: string, error: unknown): PartialFailure {
  const te = toToolError(error);
  return { label, reason: te.message, action: te.actions[0] };
}

function truncationNote(label: string, rows: number, res: DataGoKrResult): string | undefined {
  if (res.totalCount === undefined || res.totalCount <= res.items.length) return undefined;
  return `일부만 조회: ${label} 전체 ${res.totalCount}곳 중 ${res.items.length}곳만 받아 판정했습니다(요청 상한 ${rows}곳). 다른 기관이 더 있을 수 있습니다.`;
}

function clinicLine(row: { clinic: Clinic; judgement: Judgement }, i: number, slotLabel: string): string {
  const { clinic, judgement } = row;
  const lines = [
    `${i + 1}. ${clinic.name} [${clinic.kind}] — ${judgement.status}`,
    `   ${judgement.hoursText ? `운영시간(${slotLabel}): ${judgement.hoursText}` : `운영시간 확인 불가(${slotLabel} 시간 정보 없음)`}`,
  ];
  if (judgement.carriedText) lines.push(`   ${judgement.carriedText}`);
  lines.push(`   주소: ${clinic.addr ?? "정보 없음"} · 전화: ${clinic.tel ?? "정보 없음"}`);
  return lines.join("\n");
}

async function handler(args: z.output<typeof schema>, ctx: ToolContext): Promise<ToolOutput> {
  const r = normalizeRegion(args.region);
  if (!r.ok) return regionGuidance(r.message, r.candidates);
  if (r.region.sigungu === undefined) {
    return regionGuidance(
      `시도만으로는 결과가 너무 많습니다. 시군구 단위로 입력하세요(예: 서울 성동구, 수원시 영통구).`,
      [],
    );
  }

  const q = nemcQuery(r.region);
  if (!q || q.Q1 === undefined) throw new ToolError("INTERNAL", "지역 데이터 오류(NEMC 명칭 없음)");

  const at = args.now !== undefined ? parseNowInput(args.now)! : ctx.clock.now();
  const { date, minutes } = kstMoment(at);
  const prevDate = addDays(date, -1);

  const cal = await resolveHolidayCalendar([date.y, prevDate.y], ctx, {
    referenceDate: date,
    deadlineMs: Math.min(ctx.config.lawCheckTimeoutMs, ctx.config.chainDeadlineMs),
  });
  const today = slotOf(cal, date);
  const prev = slotOf(cal, prevDate);

  const callCtx: ToolContext = {
    ...ctx,
    config: { ...ctx.config, httpTimeoutMs: Math.min(ctx.config.httpTimeoutMs, ctx.config.chainDeadlineMs) },
  };
  const qt = NEMC_SEND_QT ? today.slot : undefined;
  const settled = await settleWithin(
    [
      callDataGoKr(SPECS.nemcMoonlight, { Q0: q.Q0, Q1: q.Q1, numOfRows: MOON_ROWS }, callCtx),
      callDataGoKr(
        SPECS.nemcList,
        { Q0: q.Q0, Q1: q.Q1, QD: NEMC_DEPT_PEDIATRICS, QT: qt, numOfRows: PEDS_ROWS },
        callCtx,
      ),
    ],
    ctx.config.chainDeadlineMs,
  );
  const moonR = settled[0]!;
  const pedsR = settled[1]!;

  if (!moonR.ok && !pedsR.ok) throw pickError(toToolError(moonR.error), toToolError(pedsR.error));

  const moon = moonR.ok ? moonR.value : undefined;
  const peds = pedsR.ok ? pedsR.value : undefined;
  const failed: PartialFailure[] = [];
  if (!moonR.ok) failed.push(failureOf(LABEL_MOON, moonR.error));
  if (!pedsR.ok) failed.push(failureOf(LABEL_PEDS, pedsR.error));
  const notes = [
    moon && truncationNote(LABEL_MOON, MOON_ROWS, moon),
    peds && truncationNote(LABEL_PEDS, PEDS_ROWS, peds),
  ].filter((s): s is string => typeof s === "string");

  const clinics = mergeClinics(moon?.items ?? [], peds?.items ?? []);
  const rows = sortJudged(
    clinics.map((clinic) => ({
      clinic,
      judgement: judgeOpen(clinic.item, today.slot, prev.slot, minutes, SLOT_LABEL[prev.slot]),
    })),
  );
  ctx.log.debug("night pediatric", { moon: moonR.ok, peds: pedsR.ok, clinics: clinics.length });

  const body: string[] = [
    `야간·휴일 소아 진료기관 — ${r.region.sido} ${r.region.sigungu}`,
    `기준 시각: ${formatDate(date)} ${formatHhmm(minutes)} KST · 판정 기준: ${SLOT_LABEL[today.slot]}(진료요일 ${today.slot})`,
  ];
  if (today.missingYear) {
    body.push(`${date.y}년 공휴일 정보 없음: 요일 기준으로 판정했습니다. 공휴일이면 운영시간이 다를 수 있습니다.`);
  }
  const pn = partialNotice(failed);
  if (pn !== "") body.push(pn);
  body.push(...notes);
  body.push("");
  if (rows.length === 0) {
    body.push(
      zeroResultHint("야간·휴일 소아 진료기관", [
        `지역 표기를 확인하세요(예: 서울 성동구, 수원시 영통구).`,
        `입력한 시군구가 맞는 시도에 속하는지 확인하세요.`,
        `인근 구·시로 다시 조회하세요.`,
        `키 없이 이용할 수 있는 응급의료포털(https://www.e-gen.or.kr)에서 야간·휴일 진료기관을 확인하세요.`,
      ]),
    );
  } else {
    body.push(
      summarizeList(rows, {
        limit: args.limit ?? DEFAULT_LIMIT,
        unit: "곳",
        line: (row, i) => clinicLine(row, i, SLOT_LABEL[today.slot]),
      }),
    );
  }

  const footer = composeFooter([
    sourceFooter([SPECS.nemcMoonlight, SPECS.nemcList], formatKstMinute(ctx.clock.now())),
    `판정: ${SLOT_LABEL[today.slot]} 운영시간 기준(달빛어린이병원 목록에 있는 기관은 달빛어린이병원으로 표시) · 공휴일 달력: ${holidaySourceLabel(cal, loadData("holidays").generated_at)}`,
    NOTICE_KIND,
    ...cal.notes,
    NOTICE_CALL_AHEAD,
    NOTICE_EMERGENCY,
    DISCLAIMER_CLINIC,
    NOTICE_SOURCE,
  ]);

  return { body: body.join("\n"), footer };
}

const def: ToolDef<typeof schema> = {
  name: "find_night_pediatric",
  title: "야간·휴일 소아 진료기관 찾기(국립중앙의료원 공공데이터)",
  description:
    "시군구 지역과 기준 시각으로 달빛어린이병원 목록과 소아청소년과를 진료과목으로 등록한 병·의원 목록(국립중앙의료원 공공데이터)을 조회해, 오늘 요일 또는 공휴일 운영시간 기준으로 지금 진료 중인지(진료 중/진료 시간 아님/확인 불가)를 판정하고 진료 중·달빛어린이병원·소아청소년과 이름 기관 순으로 상위 기관의 이름·구분·주소·전화·운영시간을 요약합니다. 공공데이터포털 인증키(DATA_GO_KR_SERVICE_KEY)가 필요합니다. 응급 상황은 119 또는 응급실을 이용하세요. 진단·병원 추천을 하지 않는 비공식 참고 도구입니다.",
  schema,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  requiredKeys: ["DATA_GO_KR"],
  handler,
};

export const findNightPediatricTool = def as unknown as ToolDef;
