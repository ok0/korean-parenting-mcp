import { z } from "zod";
import {
  clinicGuideContent,
  staticCheckupLinkProvider,
  type ClinicLinkProvider,
  type ClinicLinkQuery,
  type ClinicToolGuideContent,
} from "../clinic/guide.js";
import {
  CHECKUP_LIMITS,
  checkupRegionParams,
  lookupCheckupClinics,
  type CheckupClinic,
  type CheckupLookup,
} from "../clinic/checkup-lookup.js";
import {
  checkupRoundTable,
  checkupWindows,
  firstInfantRound,
  pickWindows,
  type ChildStage,
  type WindowItem,
} from "../clinic/stage.js";
import type { ToolContext } from "../core/context.js";
import { ToolError } from "../core/errors.js";
import { formatDate, type CivilDate } from "../date/civil-date.js";
import type { ToolDef, ToolOutput } from "./registry.js";
import {
  clinicFooter,
  itemLine,
  NOTICE_FINAL_CLINIC,
  NOTICE_MEDICAL_CLINIC,
  parseClinicInput,
  regionLabel,
  renderCommonSections,
  resolveRegion,
  srcLine,
  stageLabel,
  timelineSourceLine,
  uniq,
} from "./shared/clinic-text.js";
import { NOTICE_UNOFFICIAL, composeFooter } from "./shared/format.js";
import { dateField, regionField } from "./shared/schema.js";

const NOTICE_NO_LOOKUP =
  "이 도구는 의료기관 데이터를 조회하지 않으며 안내와 링크만 제공하는 비공식 도구입니다. 검진기관 조회 API의 호출 명세를 아직 확인하지 못해 조회 대신 찾는 절차를 안내합니다. 영유아 검진기관 목록은 아래 메뉴 경로나 국민건강보험공단 고객센터(1577-1000)·보건소 전화로 확인하세요.";
const NOTICE_RELATED = [
  "전체 검진·접종 일정은 get_timeline에서 아이 생년월일 기준으로 확인할 수 있습니다.",
  "지자체의 검진 관련 추가 지원이 궁금하면 find_benefits(예: keyword \"검진\")로 찾아보세요.",
];
const LOOKUP_SOURCE = "국민건강보험공단 검진기관 찾기 조회(공공데이터포털)";
const NOTICE_LOOKUP =
  "이 도구는 국민건강보험공단 검진기관 찾기 조회 결과를 옮겨 보여 주는 비공식 도구입니다. 목록은 기관 등록 정보이며 실제 검진 일정과 예약은 기관마다 다를 수 있습니다. 아래 안내와 링크도 함께 확인하세요.";
const NOTICE_LOOKUP_FALLBACK =
  "이 도구는 이번 요청에서 검진기관 목록을 보여 드리지 못해 안내와 링크만 제공하는 비공식 도구입니다(이유는 바로 아래 줄). 영유아 검진기관 목록은 아래 메뉴 경로나 국민건강보험공단 고객센터(1577-1000)·보건소 전화로 확인하세요.";
const CAUSE = {
  sidoOnly: "조회 안내: 시도만으로는 검진기관을 조회하지 않았어요. 시군구까지 알려 주시면 조회할 수 있어요. 그 전에는 아래 링크에서 찾아보세요.",
  citySplit: "조회 안내: 이 지역은 구 단위로 나뉘어 있어 조회하지 않았어요. 구까지 알려 주시면(예: 수원시 영통구) 조회할 수 있어요. 그 전에는 아래 링크나 보건소 전화로 확인하세요.",
  keyInvalid: "조회 안내: 공공데이터포털 서비스 키가 등록되지 않았거나 유효하지 않아 조회하지 못했어요. DATA_GO_KR_SERVICE_KEY 값을 확인해 주세요. 그동안은 아래 링크를 이용하세요.",
  notApproved: "조회 안내: 공공데이터포털에서 검진기관 찾기 조회 활용신청이 아직 승인되지 않아 조회하지 못했어요. 활용신청 상태를 확인해 주세요. 그동안은 아래 링크를 이용하세요.",
  limit: "조회 안내: 공공데이터포털 호출 한도에 걸려 조회하지 못했어요. 잠시 뒤(일일 한도는 다음 날) 다시 시도하거나 아래 링크를 이용하세요.",
  timeout: "조회 안내: 검진기관 조회 응답이 늦어 중단했어요. 잠시 뒤 다시 시도하거나 아래 링크를 이용하세요.",
  upstream: "조회 안내: 검진기관 조회 서버에 연결하지 못했거나 응답을 읽지 못했어요. 잠시 뒤 다시 시도하거나 아래 링크·보건소 전화로 확인하세요.",
  zero: "조회 안내: 이 지역의 검진기관 조회 결과가 0건이었어요. 지역 이름을 확인하거나 아래 링크·보건소 전화로 확인하세요.",
  noneMatched: "조회 안내: 조회된 기관 중 영유아 건강검진·구강검진 담당으로 표시된 곳이 없었어요. 아래 링크나 보건소 전화로 확인하세요.",
} as const;

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

function causeOf(err: unknown): string {
  if (err instanceof ToolError) {
    switch (err.kind) {
      case "KEY_INVALID":
      case "KEY_EXPIRED":
      case "MISSING_KEY":
        return CAUSE.keyInvalid;
      case "NOT_APPROVED":
        return CAUSE.notApproved;
      case "DAILY_LIMIT":
      case "RATE_LIMIT":
        return CAUSE.limit;
      case "TIMEOUT":
        return CAUSE.timeout;
    }
  }
  return CAUSE.upstream;
}

function clinicLine(c: CheckupClinic): string {
  const parts = [
    c.kind ? `${c.name}(${c.kind})` : c.name,
    c.address ? `주소 ${c.address}` : undefined,
    c.phone ? `전화 ${c.phone}` : undefined,
  ];
  return "- " + parts.filter((p): p is string => p !== undefined).join(" · ");
}

function listPart(title: string, rows: readonly CheckupClinic[], limit: number): string[] {
  const out = [`[${title}(${rows.length}곳)]`];
  if (rows.length === 0) {
    out.push("- 조회 결과 중 이 검진 담당으로 표시된 기관이 없었어요. 아래 링크나 보건소 전화로 확인하세요.");
  } else {
    out.push(...rows.slice(0, limit).map(clinicLine));
    if (rows.length > limit) out.push(`- 외 ${rows.length - limit}곳`);
  }
  return out;
}

function lookupSection(l: CheckupLookup, today: string): string[] {
  const infant = l.items.filter((c) => c.infant);
  const oral = l.items.filter((c) => c.oral);
  return [
    "[검진기관 조회 결과]",
    `- 출처: ${LOOKUP_SOURCE} · 조회일 ${today}`,
    "- 등록 정보 기준 목록이에요. 영유아·구강 실시 여부와 예약은 방문 전 전화로 확인하세요.",
    ...(l.total > l.received
      ? [`- 이 지역 등록 기관 ${l.total}곳 중 앞 ${l.received}곳만 확인했어요. 나머지는 아래 링크에서 찾아보세요.`]
      : []),
    ...listPart("영유아 건강검진 기관", infant, CHECKUP_LIMITS.infant),
    ...listPart("영유아 구강검진 기관", oral, CHECKUP_LIMITS.oral),
    "",
  ];
}

function lookupFooter(asOf: string, status: string): string {
  return composeFooter([
    NOTICE_FINAL_CLINIC,
    NOTICE_MEDICAL_CLINIC,
    `안내 데이터 기준일 ${asOf} · ${status}`,
    NOTICE_UNOFFICIAL,
  ]);
}

async function findCheckupClinic(args: Args, ctx: ToolContext, provider: ClinicLinkProvider): Promise<ToolOutput> {
  const { today, stage } = parseClinicInput(args, ctx);
  const { region, note } = resolveRegion(args.region);
  const { as_of, guide: g } = clinicGuideContent("checkup");
  const q: ClinicLinkQuery = { stage: stage.kind };
  if (region !== undefined) q.region = region;
  if (stage.kind === "birth") q.months = stage.months;
  const links = provider.links(q);

  const header = `영유아 건강검진 기관 찾기 안내 — 지역 ${regionLabel(region)} · ${stageLabel(stage)} · 기준일 ${formatDate(today)}`;
  const common: string[] = [
    ...renderCommonSections(g, links, region),
    ...stageSection(stage, today, g),
    "[함께 보기]",
    ...NOTICE_RELATED.map((l) => `- ${l}`),
  ];

  const keyed = ctx.config.keys.DATA_GO_KR !== undefined && ctx.upstream === undefined;
  if (!keyed || region === undefined) {
    const body: string[] = [
      header,
      "",
      NOTICE_NO_LOOKUP,
      ...(note !== undefined ? [note] : []),
      "",
      ...common,
    ];
    return { body: body.join("\n"), footer: clinicFooter(as_of) };
  }

  const rp = checkupRegionParams(region);
  let cause: string | undefined;
  let lookup: CheckupLookup | undefined;
  let outcome: string;
  if (rp.ok) {
    try {
      lookup = await lookupCheckupClinics(ctx, { siDoCd: rp.siDoCd, siGunGuCd: rp.siGunGuCd });
      if (lookup.items.length === 0) {
        cause = CAUSE.zero;
        outcome = "zero";
      } else if (!lookup.items.some((c) => c.infant || c.oral)) {
        cause = CAUSE.noneMatched;
        outcome = "none-matched";
      } else {
        outcome = "ok";
      }
    } catch (err) {
      cause = causeOf(err);
      outcome = err instanceof ToolError ? err.kind : "UPSTREAM";
    }
  } else {
    cause = rp.reason === "city-split" ? CAUSE.citySplit : CAUSE.sidoOnly;
    outcome = "unqueryable";
  }
  ctx.log.info("checkup lookup", { outcome });

  const todayText = formatDate(today);
  if (lookup !== undefined && outcome === "ok") {
    const body: string[] = [
      header,
      "",
      NOTICE_LOOKUP,
      "",
      ...lookupSection(lookup, todayText),
      ...common,
    ];
    return {
      body: body.join("\n"),
      footer: lookupFooter(as_of, `검진기관 조회: ${LOOKUP_SOURCE} · 조회일 ${todayText}`),
    };
  }

  const body: string[] = [
    header,
    "",
    NOTICE_LOOKUP_FALLBACK,
    ...(cause !== undefined ? [cause] : []),
    "",
    ...common,
  ];
  const footer =
    outcome === "unqueryable"
      ? clinicFooter(as_of)
      : lookupFooter(as_of, `검진기관 조회 시도(목록 표시 없음): ${LOOKUP_SOURCE}`);
  return { body: body.join("\n"), footer };
}

export function createFindCheckupClinicTool(provider: ClinicLinkProvider = staticCheckupLinkProvider): ToolDef {
  const def: ToolDef<typeof schema> = {
    name: "find_checkup_clinic",
    title: "영유아 건강검진 기관 찾기 안내·조회",
    description:
      "지역과 아이 생년월일(또는 출산예정일)에 맞춰 영유아 건강검진 기관 찾기를 돕습니다. 공공데이터포털 키(DATA_GO_KR_SERVICE_KEY)를 직접 설정해 실행하면 시군구의 국민건강보험공단 검진기관 찾기 조회 결과에서 영유아 건강검진·구강검진 담당으로 표시된 기관의 이름·종별·주소·전화를 함께 보여 줍니다. 키가 없거나 조회하지 못하면 기관 목록 없이 안내만 합니다. 조회 여부와 관계없이 메뉴 경로와 시도·시군구 선택 절차, 국민건강보험공단 고객센터·보건소 문의처, 방문 전 전화 확인 사항과 준비물, 표준 시기 데이터로 계산한 현재·다음 검진 회차(건강검진 8회·구강검진 4회)를 안내합니다. 예약 가능 여부나 검진 결과는 알려주지 않으며 일반 안내만 담은 비공식 참고 도구입니다. 키 없이도 쓸 수 있습니다.",
    schema,
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    handler: (args, ctx) => findCheckupClinic(args, ctx, provider),
  };
  return def as unknown as ToolDef;
}

export const findCheckupClinicTool = createFindCheckupClinicTool();
