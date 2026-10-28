import { z } from "zod";
import {
  STAGE_LABEL,
  STAGES,
  type BenefitRow,
  classifyRegion,
  compareBenefits,
  keywordTerms,
  matchScore,
  matchesFilter,
  type Scored,
  type Stage,
  stageTerms,
  toBenefitRow,
} from "../benefits/filter.js";
import { callDataGoKr, dataGoKrCacheKey, type ApiSpec } from "../clients/data-go-kr.js";
import { BENEFITS_CONCURRENCY, BENEFITS_MAX_PAGES, BENEFITS_PER_PAGE, SPECS } from "../clients/data-go-kr-specs.js";
import { formatKstMinute } from "../clients/holiday-resolve.js";
import { cached } from "../core/cache.js";
import type { ToolContext } from "../core/context.js";
import { settleWithin } from "../core/deadline.js";
import { ToolError } from "../core/errors.js";
import { normalizeRegion, type Region } from "../region/normalize.js";
import type { ToolDef, ToolOutput } from "./registry.js";
import { NOTICE_UNOFFICIAL, composeFooter, sourceFooter, summarizeList, zeroResultHint } from "./shared/format.js";
import { enumField, intField, keywordField, regionField } from "./shared/schema.js";

const DEFAULT_LIMIT = 5;
const SUMMARY_MAX = 160;
const CRITERIA_MAX = 120;
const RAW_SPEC: ApiSpec = { ...SPECS.benefitsList, cacheTtlMs: 0 };
const NOTICE_CONFIRM =
  "최종 확인: 자격·금액·신청 기간은 지자체·연도별로 다를 수 있으니 상세조회 링크나 담당 기관에서 최종 확인하세요.";
const NOTICE_MATCH =
  "검색 방식: 서비스명·요약·선정기준·분야에 단계·키워드가 들어 있는지로 고른 결과라 관련 서비스가 빠지거나 무관한 서비스가 섞일 수 있습니다.";
const NOTICE_REGION =
  "지역 구분: 소관기관명·부서명·서비스명에 지역 이름이 있는지로 판정한 근사치입니다(지역 이름이 없으면 전국/기타).";
const NOTICE_NO_APPLY = "이 도구는 신청을 대행하지 않습니다. 신청은 정부24·복지로 또는 담당 기관에서 하세요.";

const schema = z.object({
  region: regionField({
    purpose: "지원 서비스를 찾을 지역. 생략하면 지역 구분 없이 찾습니다.",
    format: "시도 또는 시도·시군구 이름 1~40자",
    example: "성동구, 경기도",
  }).optional(),
  keyword: keywordField(
    {
      purpose: "서비스명·요약·선정기준에서 찾을 단어(공백으로 여러 단어, 모두 포함).",
      format: "1~30자 문자열",
      example: "첫만남",
    },
    { max: 30 },
  ).optional(),
  stage: enumField(STAGES, {
    purpose: "생애 단계(pregnancy 임신, birth 출산, infant 영유아, all 전체).",
    format: "pregnancy, birth, infant, all 중 하나, 기본 all",
    example: "pregnancy",
  }).optional(),
  limit: intField(
    {
      purpose: "요약할 서비스 수.",
      format: "1~10 정수(숫자 문자열 허용), 기본 5",
      example: "5",
    },
    { min: 1, max: 10 },
  ).optional(),
});

interface SlimPage {
  rows: BenefitRow[];
  totalCount?: number;
}

interface Collected {
  rows: BenefitRow[];
  total: number;
  failed: { page: number; error: ToolError }[];
  capped: boolean;
}

function regionGuidance(message: string, candidates: { sido: string; sigungu?: string }[]): ToolOutput {
  let body = `지역을 확인해 주세요: ${message}`;
  if (candidates.length > 0) {
    body +=
      "\n후보:\n" +
      candidates.map((c) => `- ${c.sido} ${c.sigungu ?? ""}`.trim()).join("\n") +
      "\n후보 중 하나를 region으로 다시 조회하세요.";
  }
  return { body, footer: composeFooter([NOTICE_UNOFFICIAL]) };
}

function toToolError(e: unknown): ToolError {
  return e instanceof ToolError ? e : new ToolError("UPSTREAM", "외부 응답을 처리하지 못했습니다");
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max) + "…" : flat;
}

function fetchPage(page: number, ctx: ToolContext, callCtx: ToolContext): Promise<SlimPage> {
  return cached(
    ctx,
    dataGoKrCacheKey(SPECS.benefitsList, { page, perPage: BENEFITS_PER_PAGE }) + "#slim",
    SPECS.benefitsList.cacheTtlMs,
    async () => {
      const r = await callDataGoKr(RAW_SPEC, { page, perPage: BENEFITS_PER_PAGE }, callCtx);
      return {
        rows: r.items.map(toBenefitRow).filter((row): row is BenefitRow => row !== undefined),
        totalCount: r.totalCount,
      };
    },
  ).then((r) => r.value);
}

function gate(n: number): { run<T>(fn: () => Promise<T>): Promise<T>; stop(): void } {
  let active = 0;
  let stopped = false;
  const queue: { start: () => void; reject: (e: ToolError) => void }[] = [];
  const pump = (): void => {
    while (active < n && queue.length > 0) {
      const next = queue.shift()!;
      active++;
      next.start();
    }
  };
  return {
    run<T>(fn: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        if (stopped) {
          reject(new ToolError("TIMEOUT", "응답 시간 초과(체인 데드라인)"));
          return;
        }
        queue.push({
          start: () => {
            fn()
              .then(resolve, reject)
              .finally(() => {
                active--;
                pump();
              });
          },
          reject,
        });
        pump();
      });
    },
    stop(): void {
      stopped = true;
      for (const entry of queue.splice(0)) {
        entry.reject(new ToolError("TIMEOUT", "응답 시간 초과(체인 데드라인)"));
      }
    },
  };
}

async function collect(ctx: ToolContext): Promise<Collected> {
  const callCtx: ToolContext = {
    ...ctx,
    config: { ...ctx.config, httpTimeoutMs: Math.min(ctx.config.httpTimeoutMs, ctx.config.chainDeadlineMs) },
  };
  const t0 = Date.now();
  const firstSettled = (await settleWithin([fetchPage(1, ctx, callCtx)], ctx.config.chainDeadlineMs))[0]!;
  if (!firstSettled.ok) throw toToolError(firstSettled.error);
  const first = firstSettled.value;

  const total = first.totalCount ?? first.rows.length;
  const pageCount = Math.max(1, Math.ceil(total / BENEFITS_PER_PAGE));
  const capped = pageCount > BENEFITS_MAX_PAGES;
  const last = Math.min(pageCount, BENEFITS_MAX_PAGES);
  const pages: number[] = [];
  for (let p = 2; p <= last; p++) pages.push(p);

  const g = gate(BENEFITS_CONCURRENCY);
  const tasks = pages.map((p) => g.run(() => fetchPage(p, ctx, callCtx)));
  const settled = await settleWithin(tasks, Math.max(1, ctx.config.chainDeadlineMs - (Date.now() - t0)));
  g.stop();

  const ordered: (SlimPage | undefined)[] = [first];
  const failed: { page: number; error: ToolError }[] = [];
  settled.forEach((s, i) => {
    if (s.ok) ordered.push(s.value);
    else {
      ordered.push(undefined);
      failed.push({ page: pages[i]!, error: toToolError(s.error) });
    }
  });

  const seen = new Set<string>();
  const rows: BenefitRow[] = [];
  for (const page of ordered) {
    for (const row of page?.rows ?? []) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }
  }
  ctx.log.debug("benefits", { pages: last, failed: failed.length, rows: rows.length });
  return { rows, total, failed, capped };
}

function line(s: Scored, i: number): string {
  const r = s.row;
  const tag = s.regionClass === "local" ? " — 해당 지역" : s.regionClass === "national" ? " — 전국/기타" : "";
  const criteria = r.criteria ? ` · 선정기준: ${clip(r.criteria, CRITERIA_MAX)}` : "";
  const issuer = [r.agency, r.dept].filter(Boolean).join(" ") || "정보 없음";
  return [
    `${i + 1}. ${r.name} [${r.field ?? "분야 정보 없음"}]${tag}`,
    `   대상: ${r.userType ?? "정보 없음"}${criteria}`,
    `   요약: ${r.summary ? clip(r.summary, SUMMARY_MAX) : "응답에 요약 없음"}`,
    `   신청처: ${issuer} · 상세: ${r.url ?? "링크 없음"}`,
  ].join("\n");
}

async function handler(args: z.output<typeof schema>, ctx: ToolContext): Promise<ToolOutput> {
  const stage: Stage = args.stage ?? "all";
  let region: Region | undefined;
  if (args.region !== undefined) {
    const r = normalizeRegion(args.region);
    if (!r.ok) return regionGuidance(r.message, r.candidates);
    region = r.region;
  }

  const { rows, total, failed, capped } = await collect(ctx);

  const kw = keywordTerms(args.keyword);
  const terms = kw.length > 0 ? kw : stageTerms(stage);
  const matched: Scored[] = rows
    .filter((r) => matchesFilter(r, stage, kw))
    .map((row) => ({
      row,
      score: matchScore(row, terms),
      regionClass: region ? classifyRegion(row, region) : undefined,
    }));
  const other = region ? matched.filter((s) => s.regionClass === "other").length : 0;
  const scored = region ? matched.filter((s) => s.regionClass !== "other") : matched;
  scored.sort(compareBenefits);
  const local = scored.filter((s) => s.regionClass === "local").length;
  const national = scored.filter((s) => s.regionClass === "national").length;

  const regionText = region ? [region.sido, region.sigungu].join(" ").trim() : "전체";
  const body: string[] = [
    `지원 서비스 찾기(보조금24 목록) — 단계 ${STAGE_LABEL[stage]} · 키워드 ${args.keyword ?? "없음"} · 지역 ${regionText}`,
    `조회한 전체 ${rows.length}건 중 조건 일치 ${scored.length}건` +
      (region ? ` (해당 지역 ${local}건 · 전국/기타 ${national}건, 다른 지역 ${other}건 제외)` : ""),
  ];
  if (failed.length > 0 || capped) {
    let note = `일부만 조회됨: 전체 ${total}건 중 ${rows.length}건만 조회했습니다`;
    if (failed.length > 0) note += ` (${failed.length}개 페이지 실패: ${failed[0]!.error.message})`;
    note += ". 잠시 후 다시 조회하면 빠진 페이지만 다시 가져옵니다.";
    const action = failed[0]?.error.actions[0];
    if (action !== undefined) note += ` 조치: ${action}`;
    if (capped) note += ` 목록이 커서 앞 ${BENEFITS_MAX_PAGES * BENEFITS_PER_PAGE}건까지만 조회했습니다.`;
    body.push(note);
  }
  body.push("");
  if (scored.length === 0) {
    body.push(
      zeroResultHint("조건에 맞는 지원 서비스", [
        "keyword를 줄이거나 빼고 다시 조회하세요.",
        "지역을 시도 단위로 넓혀 보세요(예: 경기도).",
        "stage를 all로 바꿔 보세요.",
        "정부24(https://www.gov.kr) 또는 복지로(https://www.bokjiro.go.kr)에서 직접 검색하세요.",
      ]),
    );
  } else {
    body.push(summarizeList(scored, { limit: args.limit ?? DEFAULT_LIMIT, unit: "건", line }));
  }

  const footer = composeFooter([
    sourceFooter([SPECS.benefitsList], formatKstMinute(ctx.clock.now())),
    NOTICE_CONFIRM,
    NOTICE_MATCH,
    region ? NOTICE_REGION : undefined,
    NOTICE_NO_APPLY,
    NOTICE_UNOFFICIAL,
  ]);

  return { body: body.join("\n"), footer };
}

const def: ToolDef<typeof schema> = {
  name: "find_benefits",
  title: "임신·출산·영유아 지원 서비스 찾기(보조금24 공공데이터)",
  description:
    "행정안전부 공공서비스(혜택) 목록(보조금24, 공공데이터포털)에서 임신·출산·영유아 관련 지원 서비스를 생애 단계·키워드·지역으로 골라 서비스명·분야·대상·요약·신청처(담당 기관과 상세조회 링크)를 요약합니다. 목록은 하루 동안 캐시하며 지역 구분은 기관명에 따른 근사입니다. 자격·금액·신청 기간은 상세조회 링크나 담당 기관에서 최종 확인하세요. 신청을 대행하지 않는 비공식 참고 도구이며 공공데이터포털 인증키(DATA_GO_KR_SERVICE_KEY)가 필요합니다.",
  schema,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  requiredKeys: ["DATA_GO_KR"],
  handler,
};

export const findBenefitsTool = def as unknown as ToolDef;
