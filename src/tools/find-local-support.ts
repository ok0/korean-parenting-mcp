import { z } from "zod";
import type { ToolContext } from "../core/context.js";
import { ToolError } from "../core/errors.js";
import {
  HEALTH_CENTER_UNRESOLVED_LINKS,
  LOCAL_SUPPORT_FRESHNESS,
  LOCAL_SUPPORT_NOTICE,
  LOCAL_SUPPORT_STALE_MARK,
} from "../core/notice.js";
import { todayKst, formatDate, type CivilDate } from "../date/civil-date.js";
import { formatKstMinute } from "../clients/holiday-resolve.js";
import { normalizeRegion } from "../region/normalize.js";
import { welfareRegionParams } from "../region/welfare-names.js";
import { lookupHealthCenterByRegion, healthCenterLine, type HealthCenterLookup } from "../region/health-centers.js";
import { fetchLocalSupport, type LcgvStage, type LocalSupportResult } from "../local-support/fetch.js";
import {
  LCGV_APPLY_ACTION,
  isStale,
  quote,
  scopeOf,
  type LcgvDetail,
  type LcgvRow,
} from "../local-support/summarize.js";
import type { ToolDef, ToolOutput } from "./registry.js";
import { NOTICE_SOURCE, composeFooter, partialNotice, zeroResultHint } from "./shared/format.js";
import { enumField, intField, keywordField, regionField } from "./shared/schema.js";

export const STAGE_LABEL = { pregnancy: "임신·출산", infant: "영유아", all: "임신·출산·영유아" } as const;
export const NARROW_HINT = "더 좁히려면: keyword(예: 출산), stage(pregnancy·infant), 시군구를 함께 넣어 보세요.";
export const SIDO_COMMON_HINT = "시도 공통 사업은 region에 시도만 넣어 따로 찾아볼 수 있어요.";
export const CLIENT_FILTER_NOTE = "영유아 분류는 서비스 정보의 생애주기·관심주제 표기로 골랐어요(미검증 필터).";
export const ZERO_SUGGESTIONS = [
  "지역명 표기를 확인하세요(예: 전남광주통합특별시 해남군)",
  "시군구를 빼고 시도만 넣어 보세요",
  "keyword를 넓히거나 빼 보세요",
] as const;
export const LCGV_SERVICE_ERROR = "지자체복지서비스에 일시적인 오류가 생겼어요.";
export const LCGV_SERVICE_ACTION =
  "잠시 후 다시 시도해 주세요. 복지로(https://www.bokjiro.go.kr)에서도 지역 지원 서비스를 찾아볼 수 있어요.";
export const LCGV_SOURCE_LABEL = "한국사회보장정보원 지자체복지서비스(공공데이터포털)";
export const FIT_MARGIN = 100;

export function detailOnlyNote(k: number): string {
  return k > 0
    ? `상위 ${k}건만 상세 내용을 함께 보여 드려요. 나머지는 복지로 상세에서 확인하세요.`
    : "상세 내용은 각 항목의 복지로 상세에서 확인하세요.";
}

export function truncatedNote(cut: number): string {
  return `길이 제한으로 ${cut}건은 줄였어요. 범위를 좁혀 다시 찾아보세요.`;
}

export function scopeLabel(row: Pick<LcgvRow, "sgg">, sggNm: string | undefined): string {
  return sggNm !== undefined ? scopeOf(row, { sggNm }) : (row.sgg ?? "시도 공통");
}

export function healthCenterSection(hc: HealthCenterLookup): string {
  if (hc.kind === "found") {
    return `- 보건소(목록 기준일 ${hc.asOf}): ${hc.centers.map((c) => healthCenterLine(c)).join(" / ")}`;
  }
  return (
    `- 보건소: ${hc.message}` +
    (hc.candidates.length > 0 ? ` 후보: ${hc.candidates.join(", ")}` : "") +
    " " +
    HEALTH_CENTER_UNRESOLVED_LINKS
  );
}

export function itemBlock(
  row: LcgvRow,
  detail: LcgvDetail | undefined,
  sggNm: string | undefined,
  today: CivilDate,
): string {
  const lines: string[] = [`- ${row.name} [${scopeLabel(row, sggNm)}]`];
  const pieces = [
    row.dept !== undefined ? `소관 ${row.dept}` : undefined,
    row.cycle !== undefined ? `지원주기 ${row.cycle}` : undefined,
    row.provision !== undefined ? `제공 형태 ${row.provision}` : undefined,
    row.applyMethod !== undefined ? `신청 방법 ${row.applyMethod}` : undefined,
  ].filter((x): x is string => x !== undefined);
  if (pieces.length > 0) lines.push("  " + pieces.join(" · "));
  if (row.lastMod !== undefined) {
    const stale = isStale(row.lastMod, today) === true ? ` · ${LOCAL_SUPPORT_STALE_MARK}` : "";
    lines.push(`  수정일 ${formatDate(row.lastMod)}` + stale);
  } else {
    lines.push("  수정일 없음");
  }
  const digest = quote(row.digest);
  if (digest !== undefined) lines.push(`  요약(원문): "${digest}"`);
  if (detail !== undefined) {
    const fields: [string, string | undefined][] = [
      ["지원 대상(원문)", detail.target],
      ["지원 내용(원문)", detail.content],
      ["선정 기준(원문)", detail.criteria],
      ["신청 방법(원문)", detail.applyText],
    ];
    for (const [label, value] of fields) {
      const text = quote(value);
      if (text !== undefined) lines.push(`  ${label}: "${text}"`);
    }
    if (detail.contacts.length > 0) {
      lines.push(
        `  문의처: ${detail.contacts.map((c) => (c.value !== undefined ? `${c.name} ${c.value}` : c.name)).join("; ")}`,
      );
    }
    if (detail.laws.length > 0) lines.push(`  근거 법령: ${detail.laws.join(", ")}`);
  }
  if (row.link !== undefined) lines.push(`  복지로 상세: ${row.link}`);
  return lines.join("\n");
}

export function fitCount(fixedLen: number, blocks: readonly string[], budget: number): number {
  let k = 0;
  let used = fixedLen;
  while (k < blocks.length) {
    const next = used + blocks[k]!.length + 2;
    if (next > budget) break;
    used = next;
    k += 1;
  }
  return k;
}

function regionGuidance(message: string, candidates: string[]): ToolOutput {
  const list =
    candidates.length > 0
      ? "\n후보:\n" + candidates.map((c) => "- " + c).join("\n") + "\n후보 중 하나를 region으로 다시 찾아보세요."
      : "";
  return { body: `지역을 확인해 주세요: ${message}` + list, footer: composeFooter([NOTICE_SOURCE]) };
}

function userError(e: unknown): unknown {
  if (e instanceof ToolError && e.kind === "UPSTREAM" && e.detail?.code !== "99") {
    return new ToolError("UPSTREAM", LCGV_SERVICE_ERROR, { actions: [LCGV_SERVICE_ACTION] });
  }
  return e;
}

function contactLine(rows: readonly LcgvRow[], details: ReadonlyMap<string, LcgvDetail>): string {
  const entries: string[] = [];
  const add = (s: string): void => {
    if (!entries.includes(s)) entries.push(s);
  };
  for (const r of rows) {
    if (r.dept !== undefined) add(r.dept);
  }
  for (const r of rows) {
    const d = details.get(r.servId);
    if (d === undefined) continue;
    for (const c of d.contacts) add(c.value !== undefined ? `${c.name} ${c.value}` : c.name);
  }
  return entries.length > 0
    ? `- 소관 부서·문의처: ${entries.slice(0, 6).join(" / ")}`
    : "- 소관 부서·문의처: 각 항목의 복지로 상세에서 문의처를 확인하세요.";
}

function buildFooter(
  rows: readonly LcgvRow[],
  res: LocalSupportResult,
  hc: HealthCenterLookup,
  ctx: ToolContext,
): string {
  const when =
    res.stale !== undefined
      ? `저장해 둔 응답 · 조회 후 ${Math.max(1, Math.floor(res.stale.ageMs / 3_600_000))}시간`
      : `조회 시각 ${formatKstMinute(ctx.clock.now())} KST`;
  const sourceLine = "출처: " + LCGV_SOURCE_LABEL + " · " + when;
  return composeFooter([
    "[확인처]\n" +
      [
        contactLine(rows, res.details),
        "- 복지로: https://www.bokjiro.go.kr",
        healthCenterSection(hc),
        "- 정부24·보조금24: https://www.gov.kr",
      ].join("\n"),
    LOCAL_SUPPORT_FRESHNESS,
    sourceLine,
    NOTICE_SOURCE,
  ]);
}

const schema = z.object({
  region: regionField({
    purpose: "지원 서비스를 찾을 지역(시도 또는 시군구).",
    format: "시도·시군구 이름 1~40자, 시도만 넣으면 시도 전체",
    example: "서울 마포구, 전남 해남군, 경기도",
  }),
  stage: enumField(["pregnancy", "infant", "all"] as const, {
    purpose: "육아 단계.",
    format: "pregnancy(임신·출산), infant(영유아), all(전체, 기본값)",
    example: "pregnancy",
  }).optional(),
  keyword: keywordField(
    { purpose: "서비스 이름·내용 검색어(선택).", format: "1~20자", example: "출산" },
    { max: 20 },
  ).optional(),
  limit: intField(
    { purpose: "보여 줄 최대 항목 수.", format: "1~10 정수, 기본 5", example: "5" },
    { min: 1, max: 10 },
  ).optional(),
});

async function handler(args: z.output<typeof schema>, ctx: ToolContext): Promise<ToolOutput> {
  const stage: LcgvStage = args.stage ?? "all";
  const limit = args.limit ?? 5;

  const r = normalizeRegion(args.region);
  if (!r.ok) {
    return regionGuidance(
      r.message,
      r.candidates.map((c) => [c.sido, c.sigungu].filter(Boolean).join(" ")),
    );
  }
  const w = welfareRegionParams(r.region);
  if (!w.ok) return regionGuidance(w.message, w.candidates);

  let res: LocalSupportResult;
  try {
    res = await fetchLocalSupport({ region: w.params, stage, keyword: args.keyword, limit }, ctx);
  } catch (e) {
    throw userError(e);
  }

  const hc = lookupHealthCenterByRegion(r.region);
  const today = todayKst(ctx.clock);
  const sggNm = w.params.sggNm;
  const head = (m: number): string =>
    `지역 육아 지원 서비스(참고용): ${w.params.label} · ${STAGE_LABEL[stage]} · 전체 ${res.total}건 중 ${m}건`;

  if (res.rows.length === 0) {
    const lines = [head(0), LOCAL_SUPPORT_NOTICE, "", zeroResultHint("지역 지원 서비스", ZERO_SUGGESTIONS)];
    if (res.stageFilter === "client" && stage === "infant") lines.push(CLIENT_FILTER_NOTE);
    return { body: lines.join("\n"), footer: buildFooter([], res, hc, ctx) };
  }

  const shown = res.rows.slice(0, limit);
  const blocks = shown.map((row) => itemBlock(row, res.details.get(row.servId), sggNm, today));

  const tail = (kept: readonly LcgvRow[], cut: number): string[] => {
    const k = kept.filter((row) => res.details.has(row.servId)).length;
    const out: string[] = [];
    if (k < kept.length) out.push(detailOnlyNote(k));
    out.push(NARROW_HINT);
    if (sggNm !== undefined && res.sidoCommonMayBeMissing) out.push(SIDO_COMMON_HINT);
    if (res.stageFilter === "client") out.push(CLIENT_FILTER_NOTE);
    if (res.detailFailed > 0) {
      out.push(
        partialNotice([
          { label: "상세 정보", reason: `${res.detailFailed}건 응답 없음`, action: "복지로 상세에서 확인하세요" },
        ]),
      );
    }
    if (cut > 0) out.push(truncatedNote(cut));
    return out;
  };

  const footer0 = buildFooter(shown, res, hc, ctx);
  const budget = ctx.config.maxResponseChars - footer0.length - 2 - 80 - FIT_MARGIN;
  const fixedLen = head(shown.length).length + LOCAL_SUPPORT_NOTICE.length + tail(shown, 1).join("\n").length + 8;
  const kept = fitCount(fixedLen, blocks, budget);
  const cut = shown.length - kept;

  const body = [
    head(kept),
    LOCAL_SUPPORT_NOTICE,
    "",
    blocks.slice(0, kept).join("\n\n"),
    "",
    ...tail(shown.slice(0, kept), cut),
  ].join("\n");
  return { body, footer: buildFooter(shown.slice(0, kept), res, hc, ctx) };
}

const def: ToolDef<typeof schema> = {
  name: "find_local_support",
  title: "우리 지역 육아 지원 서비스 찾기(참고용)",
  description:
    "시도·시군구의 임신·출산·영유아 지원 서비스를 공공데이터포털의 한국사회보장정보원 지자체복지서비스 정보로 찾아 참고용으로 보여 줘요. 서비스명·소관 부서·수정일·원문 요약과 복지로 상세 링크를 함께 드려요. 신청 조건과 금액은 해당 지자체에 확인하세요. 공공데이터포털 키(DATA_GO_KR_SERVICE_KEY)와 '한국사회보장정보원_지자체복지서비스'(15108347) 활용신청이 필요해요.",
  schema,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  requiredKeys: ["DATA_GO_KR"],
  keyActions: [LCGV_APPLY_ACTION],
  handler,
};

export const findLocalSupportTool = def as unknown as ToolDef;
