import { z } from "zod";
import {
  clinicGuideContent,
  staticVaccinationLinkProvider,
  type ClinicLinkProvider,
  type ClinicLinkQuery,
  type ClinicToolGuideContent,
} from "../clinic/guide.js";
import {
  birthDoses,
  pickWindows,
  vaccineWindows,
  WINDOW_IMMINENT_DAYS,
  type ChildStage,
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
  "이 도구는 의료기관 데이터를 조회하지 않으며 안내와 링크만 제공하는 도구입니다. 전국 위탁의료기관 공개 API를 확인하지 못해 조회 대신 찾는 절차를 안내합니다. 기관 목록과 접종 가능 백신은 아래 위탁의료기관 찾기 화면과 보건소·의료기관 전화로 확인하세요.";
const NOTICE_RELATED = [
  "전체 접종·검진 일정은 get_timeline에서 아이 생년월일 기준으로 확인할 수 있습니다.",
  "지자체의 접종 관련 추가 지원이 궁금하면 find_benefits(예: keyword \"예방접종\")로 찾아보세요.",
];

const schema = z.object({
  region: regionField({
    purpose: "위탁의료기관을 찾을 지역(시군구 단위). 생략하면 지역 없이 일반 안내.",
    format: "시도·시군구 이름 1~40자, 시도 생략 가능",
    example: "성동구, 수원 영통구",
  }).optional(),
  birth_date: dateField({
    purpose: "아이 생년월일. 월령에 맞춘 접종 차수 안내에 사용(due_date와 함께 쓰지 않음).",
    format: "YYYY-MM-DD",
    example: "2026-05-28",
  }).optional(),
  due_date: dateField({
    purpose: "출산예정일(임신 중일 때). 출생 후 접종 안내에 사용(birth_date와 함께 쓰지 않음).",
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
  const out: string[] = ["[아이 단계 정보 — 국가예방접종 차수]", `- 기준: ${stageLabel(stage)} · 기준일 ${formatDate(today)}`];
  if (stage.kind === "birth") {
    const all = vaccineWindows(stage.birth);
    const p = pickWindows(all, today);
    out.push(`- 지금 기간 중인 차수:${p.current.length === 0 ? " 없음" : ""}`);
    for (const i of p.current) out.push(`  - ${itemLine(i)}`);
    out.push(`- 직전 기간 차수(기간 지남, 접종 기록 확인):${p.recent.length === 0 ? " 없음" : ""}`);
    for (const i of p.recent) out.push(`  - ${itemLine(i)}`);
    if (p.nextStart === undefined) {
      out.push("- 다음 접종 시기: 등록된 차수 없음");
    } else {
      out.push(`- 다음 접종 시기: ${formatDate(p.nextStart)}${p.imminent ? ` (${WINDOW_IMMINENT_DAYS}일 이내 시작)` : ""}`);
      for (const i of p.next) out.push(`  - ${itemLine(i)}`);
    }
    const listed = [...p.current, ...p.recent, ...p.next];
    for (const n of uniq(listed.flatMap((i) => i.notes))) out.push(`  참고: ${n}`);
    out.push(`  ${timelineSourceLine((listed.length > 0 ? listed : all).map((i) => i.provenance))}`);
    for (const line of g.stage_text.birth_notes) out.push(`- ${line}`);
  } else if (stage.kind === "due") {
    const d = birthDoses();
    const titles = d.map((x) => x.title).join(", ");
    for (const line of g.stage_text.due_lines) out.push(`- ${line.replaceAll("{birth_items}", titles)}`);
    out.push(`  ${timelineSourceLine(d.map((x) => x.provenance))}`);
  } else {
    for (const line of g.stage_text.none_lines) out.push(`- ${line}`);
  }
  out.push(`  ${srcLine(g.stage_text)}`, "");
  return out;
}

async function findVaccinationClinic(args: Args, ctx: ToolContext, provider: ClinicLinkProvider): Promise<ToolOutput> {
  const { today, stage } = parseClinicInput(args, ctx);
  const { region, note } = resolveRegion(args.region);
  const { as_of, guide: g } = clinicGuideContent("vaccination");
  const q: ClinicLinkQuery = { stage: stage.kind };
  if (region !== undefined) q.region = region;
  if (stage.kind === "birth") q.months = stage.months;
  const links = provider.links(q);

  const body = [
    `예방접종 위탁의료기관 찾기 안내 — 지역 ${regionLabel(region)} · ${stageLabel(stage)} · 기준일 ${formatDate(today)}`,
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

export function createFindVaccinationClinicTool(provider: ClinicLinkProvider = staticVaccinationLinkProvider): ToolDef {
  const def: ToolDef<typeof schema> = {
    name: "find_vaccination_clinic",
    title: "예방접종 위탁의료기관 찾기 링크 안내(조회 없음)",
    description:
      "지역과 아이 생년월일(또는 출산예정일)에 맞춰 국가예방접종 위탁의료기관을 찾는 화면 링크와 시도·시군구 선택 절차, 보건소·콜센터 문의처, 방문 전 전화 확인 사항과 준비물, 표준 일정 데이터로 계산한 현재·다음 접종 차수를 안내합니다. 의료기관 데이터를 조회하지 않아 기관 목록·재고·예약 가능 여부는 알려주지 않으며 접종 시기 판단이 아닌 일반 안내만 담은 참고 도구입니다. API 키가 필요 없습니다.",
    schema,
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    handler: (args, ctx) => findVaccinationClinic(args, ctx, provider),
  };
  return def as unknown as ToolDef;
}

export const findVaccinationClinicTool = createFindVaccinationClinicTool();
