import { z } from "zod";
import {
  clinicGuideContent,
  staticCheckupLinkProvider,
  type ClinicLinkProvider,
  type ClinicLinkQuery,
  type ClinicToolGuideContent,
} from "../clinic/guide.js";
import {
  checkupRoundTable,
  checkupWindows,
  firstInfantRound,
  pickWindows,
  type ChildStage,
  type WindowItem,
} from "../clinic/stage.js";
import type { ToolContext } from "../core/context.js";
import { formatDate, type CivilDate } from "../date/civil-date.js";
import type { ToolDef, ToolOutput } from "./registry.js";
import {
  clinicFooter,
  itemLine,
  parseClinicInput,
  regionLabel,
  renderCommonSections,
  resolveRegion,
  srcLine,
  stageLabel,
  timelineSourceLine,
  uniq,
} from "./shared/clinic-text.js";
import { dateField, regionField } from "./shared/schema.js";

const NOTICE_NO_LOOKUP =
  "이 도구는 의료기관 데이터를 조회하지 않으며 안내와 링크만 제공하는 비공식 도구입니다. 검진기관 조회 API의 호출 명세를 아직 확인하지 못해 조회 대신 찾는 절차를 안내합니다. 영유아 검진기관 목록은 아래 메뉴 경로나 국민건강보험공단 고객센터(1577-1000)·보건소 전화로 확인하세요.";
const NOTICE_RELATED = [
  "전체 검진·접종 일정은 get_timeline에서 아이 생년월일 기준으로 확인할 수 있습니다.",
  "지자체의 검진 관련 추가 지원이 궁금하면 find_benefits(예: keyword \"검진\")로 찾아보세요.",
];

const schema = z.object({
  region: regionField({
    purpose: "영유아 건강검진 기관을 찾을 지역(시군구 단위). 생략하면 지역 없이 일반 안내.",
    format: "시도·시군구 이름 1~40자, 시도 생략 가능",
    example: "성동구, 수원 영통구",
  }).optional(),
  birth_date: dateField({
    purpose: "아이 생년월일. 월령에 맞춘 검진 회차 안내에 사용(due_date와 함께 쓰지 않음).",
    format: "YYYY-MM-DD",
    example: "2026-05-28",
  }).optional(),
  due_date: dateField({
    purpose: "출산예정일(임신 중일 때). 첫 검진 시기 안내에 사용(birth_date와 함께 쓰지 않음).",
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

function stageSection(stage: ChildStage, today: CivilDate, g: ClinicToolGuideContent): string[] {
  const out: string[] = [
    "[아이 단계 정보 — 영유아 검진 회차]",
    `- 기준: ${stageLabel(stage)} · 기준일 ${formatDate(today)}`,
  ];
  if (stage.kind === "birth") {
    const all: WindowItem[] = [];
    const listed: WindowItem[] = [];
    for (const p of checkupWindows(stage.birth)) {
      const pick = pickWindows(p.items, today);
      out.push(`- ${p.label} 지금 기간 중인 회차:` + (pick.current.length === 0 ? " 없음" : ""));
      for (const i of pick.current) out.push(`  - ${itemLine(i)}`);
      out.push(`- ${p.label} 다음 회차:` + (pick.next.length === 0 ? " 등록된 회차 없음" : ""));
      for (const i of pick.next) out.push(`  - ${itemLine(i)}`);
      all.push(...p.items);
      listed.push(...pick.current, ...pick.next);
    }
    for (const n of uniq(listed.flatMap((i) => i.notes))) out.push(`  참고: ${n}`);
    out.push(`  ${timelineSourceLine((listed.length > 0 ? listed : all).map((i) => i.provenance))}`);
    for (const line of g.stage_text.birth_notes) out.push(`- ${line}`);
  } else if (stage.kind === "due") {
    const f = firstInfantRound();
    for (const line of g.stage_text.due_lines) out.push(`- ${line.replaceAll("{birth_items}", f.label)}`);
    out.push(`  ${timelineSourceLine([f.provenance])}`);
  } else {
    for (const line of g.stage_text.none_lines) out.push(`- ${line}`);
    const t = checkupRoundTable();
    for (const x of t) out.push(`- ${x.label}: ${x.rounds.join(", ")}`);
    out.push(`  ${timelineSourceLine(t.flatMap((x) => x.provenance))}`);
  }
  out.push(`  ${srcLine(g.stage_text)}`, "");
  return out;
}

async function findCheckupClinic(args: Args, ctx: ToolContext, provider: ClinicLinkProvider): Promise<ToolOutput> {
  const { today, stage } = parseClinicInput(args, ctx);
  const { region, note } = resolveRegion(args.region);
  const { as_of, guide: g } = clinicGuideContent("checkup");
  const q: ClinicLinkQuery = { stage: stage.kind };
  if (region !== undefined) q.region = region;
  if (stage.kind === "birth") q.months = stage.months;
  const links = provider.links(q);

  const body: string[] = [
    `영유아 건강검진 기관 찾기 안내 — 지역 ${regionLabel(region)} · ${stageLabel(stage)} · 기준일 ${formatDate(today)}`,
    "",
    NOTICE_NO_LOOKUP,
    ...(note !== undefined ? [note] : []),
    "",
    ...renderCommonSections(g, links, region),
    ...stageSection(stage, today, g),
    "[함께 보기]",
    ...NOTICE_RELATED.map((l) => `- ${l}`),
  ];

  return { body: body.join("\n"), footer: clinicFooter(as_of) };
}

export function createFindCheckupClinicTool(provider: ClinicLinkProvider = staticCheckupLinkProvider): ToolDef {
  const def: ToolDef<typeof schema> = {
    name: "find_checkup_clinic",
    title: "영유아 건강검진 기관 찾기 안내(조회 없음)",
    description:
      "지역과 아이 생년월일(또는 출산예정일)에 맞춰 영유아 건강검진 기관을 찾는 메뉴 경로와 시도·시군구 선택 절차, 국민건강보험공단 고객센터·보건소 문의처, 방문 전 전화 확인 사항과 준비물, 표준 시기 데이터로 계산한 현재·다음 검진 회차(건강검진 8회·구강검진 4회)를 안내합니다. 검진기관 데이터를 조회하지 않아 기관 목록·예약 가능 여부나 검진 결과는 알려주지 않으며 일반 안내만 담은 비공식 참고 도구입니다. API 키가 필요 없습니다.",
    schema,
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    handler: (args, ctx) => findCheckupClinic(args, ctx, provider),
  };
  return def as unknown as ToolDef;
}

export const findCheckupClinicTool = createFindCheckupClinicTool();
