import { z } from "zod";
import type { ToolContext } from "../core/context.js";
import { ToolError } from "../core/errors.js";
import { formatDate, parseDate, todayKst } from "../date/civil-date.js";
import {
  daycareStage,
  guideContent,
  staticLinkProvider,
  type DaycareLink,
  type DaycareLinkProvider,
} from "../daycare/guide.js";
import { normalizeRegion, type Region } from "../region/normalize.js";
import type { ToolDef, ToolOutput } from "./registry.js";
import { NOTICE_SOURCE, composeFooter, verifiedText } from "./shared/format.js";
import { dateField, regionField } from "./shared/schema.js";

const NOTICE_NO_LOOKUP =
  "이 도구는 데이터를 조회하지 않으며 링크와 일반 안내만 제공하는 도구입니다. 어린이집 정원·현원·대기 순번·비용 정보는 알 수 없으니 아래 링크와 시·군·구청, 해당 어린이집에서 확인하세요.";
const NOTICE_LINK_CHANGE =
  "링크 변경 가능: 어린이집·유치원 통합(유보통합) 포털 이관에 따라 주소나 메뉴가 바뀔 수 있습니다. 링크가 열리지 않으면 대체 링크(첫 화면)에서 메뉴를 찾아가세요.";
const NOTICE_FINAL =
  "최종 확인: 정원·대기 순번·비용·입소 기준은 공식 포털, 관할 시·군·구청, 해당 어린이집에서 확인하세요.";
const NOTICE_RELATED = [
  "지역 보육 지원 정책(보육료 지원, 지자체 추가 지원 등)은 find_benefits(예: keyword \"보육\")로 찾아보세요.",
  "보육료·부모급여 등 신청 기한은 get_timeline에서 아이 일정과 함께 확인할 수 있습니다.",
];

const schema = z.object({
  region: regionField({
    purpose: "어린이집을 찾을 지역(시군구 단위). 생략하면 지역 없이 일반 안내.",
    format: "시도·시군구 이름 1~40자, 시도 생략 가능",
    example: "성동구, 수원 영통구",
  }).optional(),
  birth_date: dateField({
    purpose: "아이 생년월일. 월령에 맞춘 입소대기 안내에 사용(due_date와 함께 쓰지 않음).",
    format: "YYYY-MM-DD",
    example: "2026-05-28",
  }).optional(),
  due_date: dateField({
    purpose: "출산예정일(임신 중일 때). 임신 중 안내에 사용(birth_date와 함께 쓰지 않음).",
    format: "YYYY-MM-DD",
    example: "2027-03-15",
  }).optional(),
  today: dateField({
    purpose: "기준일. 생략하면 오늘(한국 시간)이며 월령 계산에 사용.",
    format: "YYYY-MM-DD",
    example: "2026-10-28",
  }).optional(),
});

type Args = z.output<typeof schema>;

interface SourceLike {
  source: string;
  as_of: string;
  verified: "partial" | "false";
  note?: string;
}

function src(p: SourceLike): string {
  return `출처: ${p.source} · 기준일 ${p.as_of} · ${verifiedText(p.verified)}` + (p.note !== undefined ? ` · ${p.note}` : "");
}

function fill(t: string, region: Region): string {
  return t.replaceAll("{sido}", region.sido).replaceAll("{sigungu}", region.sigungu ?? "");
}

function regionFailNote(message: string, candidates: readonly Region[]): string {
  let note = `지역을 확인해 주세요: ${message}`;
  if (candidates.length > 0) {
    note +=
      "\n후보:\n" +
      candidates.map((c) => `- ${c.sido} ${c.sigungu ?? ""}`.trim()).join("\n") +
      "\n후보 중 하나를 region으로 다시 조회하면 지역 선택 절차가 구체화됩니다.";
  }
  return note + "\n아래 링크와 안내는 지역 없이 표시합니다.";
}

async function findDaycare(args: Args, ctx: ToolContext, provider: DaycareLinkProvider): Promise<ToolOutput> {
  if (args.birth_date !== undefined && args.due_date !== undefined) {
    throw new ToolError(
      "BAD_INPUT",
      "birth_date와 due_date는 함께 쓸 수 없습니다. 출산 전이면 due_date, 출산 후면 birth_date 하나만 입력하세요.",
    );
  }
  const today = args.today !== undefined ? parseDate(args.today) : todayKst(ctx.clock);
  const st = daycareStage(
    {
      birth: args.birth_date !== undefined ? parseDate(args.birth_date) : undefined,
      due: args.due_date !== undefined ? parseDate(args.due_date) : undefined,
    },
    today,
  );
  if (!st.ok) throw new ToolError("BAD_INPUT", st.message);

  let region: Region | undefined;
  let regionNote: string | undefined;
  if (args.region !== undefined) {
    const r = normalizeRegion(args.region);
    if (r.ok) region = r.region;
    else regionNote = regionFailNote(r.message, r.candidates);
  }

  const g = guideContent();
  const links: readonly DaycareLink[] = provider.links({ stage: st.stage, region });
  const stageGuide = g.waitlist.stages[st.stage];
  const regionText = region !== undefined ? [region.sido, region.sigungu].filter(Boolean).join(" ") : "미지정";

  const body: string[] = [
    `어린이집 찾기·입소대기 안내 — 지역 ${regionText} · 단계 ${stageGuide.label}${st.months !== undefined ? `(생후 ${st.months}개월)` : ""} · 기준일 ${formatDate(today)}`,
    "",
    NOTICE_NO_LOOKUP,
  ];
  if (regionNote !== undefined) body.push(regionNote);
  body.push("", "[링크]");
  for (const l of links) body.push(`- ${l.label}: ${l.url}`, `  용도: ${l.purpose}`, `  ${src(l)}`);
  body.push(NOTICE_LINK_CHANGE, "");

  body.push("[지역 선택 절차]");
  if (region !== undefined && region.sigungu !== undefined) {
    body.push(`- ${fill(g.region_steps.with_region, region)}`, `- ${fill(g.region_steps.local_contact, region)}`);
  } else if (region !== undefined) {
    body.push(`- ${fill(g.region_steps.with_sido, region)}`, `- ${g.region_steps.local_contact_default}`);
  } else {
    for (const line of g.region_steps.general) body.push(`- ${line}`);
    body.push(`- ${g.region_steps.local_contact_default}`);
  }
  body.push(`  ${src(g.region_steps)}`, "");

  body.push(`[입소대기(등록대기) 절차와 시기 — ${stageGuide.label}]`);
  for (const line of stageGuide.lines) body.push(`- ${line}`);
  for (const line of g.waitlist.common) body.push(`- ${line}`);
  body.push(`  ${src(g.waitlist)}`, "");

  body.push("[어린이집 비교 항목]", `- 공통: ${g.comparison.common.join(", ")}`);
  for (const t of g.comparison.types) body.push(`- ${t.name}: ${t.focus.join(" / ")}`);
  body.push(`  ${src(g.comparison)}`, "");

  body.push("[함께 보기]", ...NOTICE_RELATED.map((line) => `- ${line}`));

  const footer = composeFooter([
    NOTICE_FINAL,
    `안내 데이터 기준일 ${g.as_of} · 조회 없음(외부 호출 0회)`,
    NOTICE_SOURCE,
  ]);

  return { body: body.join("\n"), footer };
}

export function createFindDaycareTool(provider: DaycareLinkProvider = staticLinkProvider): ToolDef {
  const def: ToolDef<typeof schema> = {
    name: "find_daycare",
    title: "어린이집 찾기·입소대기 링크 안내(조회 없음)",
    description:
      "지역과 아이 생년월일(또는 출산예정일)에 맞춰 어린이집 검색·입소대기(등록대기) 신청 페이지 링크, 지역 선택 절차, 어린이집 유형별 확인 항목, 입소대기 절차와 시기를 안내합니다. 외부 데이터를 조회하지 않아 정원·현원·대기 순번·비용 정보는 알려주지 않으며 링크와 일반 안내만 담은 참고 도구입니다. API 키가 필요 없습니다.",
    schema,
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    handler: (args, ctx) => findDaycare(args, ctx, provider),
  };
  return def as unknown as ToolDef;
}

export const findDaycareTool = createFindDaycareTool();
