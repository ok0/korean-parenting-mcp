import { z } from "zod";
import { formatKstMinute } from "../clients/holiday-resolve.js";
import { callSafetyKorea, SK_MAX_ROWS, SK_SPECS, type SkResult, type SkService } from "../clients/safetykorea.js";
import { settleWithin } from "../core/deadline.js";
import type { ToolContext } from "../core/context.js";
import { ToolError } from "../core/errors.js";
import { RECALL_REFERENCE_NOTICE } from "../core/notice.js";
import {
  CHILD_KEYWORDS,
  compareRows,
  dedupeRows,
  SOURCE_LABEL,
  toRecallRow,
  type RecallRow,
} from "../recall/summarize.js";
import type { ToolDef, ToolOutput } from "./registry.js";
import {
  composeFooter,
  NOTICE_SOURCE,
  partialNotice,
  type SourceRef,
  sourceFooter,
  summarizeList,
  zeroResultHint,
} from "./shared/format.js";
import { boolField, intField, keywordField } from "./shared/schema.js";

const DEFAULT_LIMIT = 5;
const PRODUCT_MAX = 80;
const FIELD_MAX = 60;
const REASON_MAX = 160;
const ACTION_MAX = 120;
const ATTRIBUTION = "제품안전정보센터(SafetyKorea) Open API";
const SITE_URL = "https://www.safetykorea.kr";
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
const NOTICE_NO_HISTORY = "리콜 기록을 찾지 못한 제품도 사용 전에 제조사·판매처 안내를 함께 확인해 주세요.";
const NOTICE_CHILD = `어린이제품 구분: 서버에 어린이제품 분류 조건이 없어 제품명·모델·분류·사유에 어린이 관련 키워드(${CHILD_KEYWORDS.slice(0, 8).join(", ")} 등)가 있는지로 표시한 근사치입니다. 키워드 기반이라 어린이제품이 빠지거나 다른 제품이 함께 포함될 수 있습니다. 키워드가 없는 항목도 숨기지 않고 '어린이제품 여부 불명'으로 표시합니다(필터로 제외한 항목 0건).`;
const NOTICE_KC = "KC 인증 항목은 인증 기록이에요(리콜 기록과 구분해 인증 상태를 함께 표시).";
const DISCLAIMER_RECALL = `리콜 정보 면책: ${RECALL_REFERENCE_NOTICE}`;

const schema = z.object({
  product_name: keywordField(
    {
      purpose: "리콜·안전성조사 이력을 찾아볼 제품명. 제품명 일부로 조회하며 브랜드·모델명은 결과가 없을 수 있음.",
      format: "2~50자 문자열(앞뒤 공백 제거)",
      example: "카시트, 유모차",
    },
    { min: 2, max: 50 },
  ),
  limit: intField(
    {
      purpose: "요약할 항목 수.",
      format: "1~10 정수(숫자 문자열 허용), 기본 5",
      example: "5",
    },
    { min: 1, max: 10 },
  ).optional(),
  include_certification: boolField({
    purpose: "KC 인증정보도 함께 조회할지 여부(인증 기록으로, 리콜 기록과 구분해 표시).",
    format: "true 또는 false, 기본 false",
    example: "false",
  }).optional(),
});

export function normalizeProductName(s: string): string {
  return s.normalize("NFKC").trim().replace(/\s+/g, " ");
}

function clip(t: string, n: number): string {
  return t.length > n ? t.slice(0, n) + "…" : t;
}

function toToolError(e: unknown): ToolError {
  return e instanceof ToolError ? e : new ToolError("UPSTREAM", "외부 응답을 처리하지 못했습니다");
}

function pickError(errors: readonly ToolError[]): ToolError {
  const rank = (e: ToolError): number => {
    const i = ERROR_PRIORITY.indexOf(e.kind);
    return i === -1 ? ERROR_PRIORITY.length : i;
  };
  let best = errors[0]!;
  for (const e of errors.slice(1)) {
    if (rank(e) < rank(best)) best = e;
  }
  return best;
}

function joinDefined(parts: readonly (string | undefined)[], sep: string): string | undefined {
  const defined = parts.filter((p): p is string => p !== undefined);
  return defined.length === 0 ? undefined : defined.join(sep);
}

function line(r: RecallRow, i: number): string {
  const lines: string[] = [
    `${i + 1}. [${SOURCE_LABEL[r.service]}] ${r.product !== undefined ? clip(r.product, PRODUCT_MAX) : "제품명 정보 없음"} — ${r.child ? "어린이제품 가능성(키워드)" : "어린이제품 여부 불명"}`,
  ];
  const modelBrand = joinDefined(
    [
      r.model !== undefined ? `모델: ${clip(r.model, FIELD_MAX)}` : undefined,
      r.brand !== undefined ? `브랜드: ${clip(r.brand, FIELD_MAX)}` : undefined,
    ],
    " · ",
  );
  if (modelBrand !== undefined) lines.push(`   ${modelBrand}`);
  const companyCountry = joinDefined(
    [
      r.company !== undefined ? `업체: ${clip(r.company, FIELD_MAX)}` : undefined,
      r.country !== undefined ? `제조국: ${r.country}` : undefined,
    ],
    " · ",
  );
  if (companyCountry !== undefined) lines.push(`   ${companyCountry}`);
  const dateLabel = r.service === "certificationList" ? "인증일" : "공표일";
  lines.push(
    `   ${dateLabel}: ${r.date ?? "정보 없음"}${r.kind !== undefined ? ` · 구분: ${clip(r.kind, FIELD_MAX)}` : ""}`,
  );
  if (r.publisher !== undefined) lines.push(`   공표 기관: ${r.publisher}`);
  if (r.reason !== undefined) lines.push(`   사유·위해: ${clip(r.reason, REASON_MAX)}`);
  if (r.action !== undefined) lines.push(`   조치: ${clip(r.action, ACTION_MAX)}`);
  if (r.certState !== undefined) lines.push(`   인증 상태: ${r.certState}`);
  if (r.contact !== undefined) lines.push(`   문의: ${r.contact}`);
  if (r.url !== undefined) lines.push(`   상세: ${r.url}`);
  return lines.join("\n");
}

async function handler(args: z.output<typeof schema>, ctx: ToolContext): Promise<ToolOutput> {
  const name = normalizeProductName(args.product_name);
  const extra: SkService[] = args.include_certification ? ["certificationList"] : [];
  const services: SkService[] = ["recallList", "fRecallList", "overseasList", ...extra];
  const callCtx: ToolContext = {
    ...ctx,
    config: { ...ctx.config, httpTimeoutMs: Math.min(ctx.config.httpTimeoutMs, ctx.config.chainDeadlineMs) },
  };
  const settled = await settleWithin(
    services.map((s) => callSafetyKorea(s, name, callCtx)),
    ctx.config.chainDeadlineMs,
  );

  const ok: { service: SkService; res: SkResult }[] = [];
  const failed: { service: SkService; error: ToolError }[] = [];
  services.forEach((service, i) => {
    const r = settled[i]!;
    if (r.ok) ok.push({ service, res: r.value });
    else failed.push({ service, error: toToolError(r.error) });
  });
  if (ok.length === 0) throw pickError(failed.map((f) => f.error));

  const rows = dedupeRows(
    ok.flatMap(({ service, res }) => res.items.map((item) => toRecallRow(service, item))),
  ).sort(compareRows);
  const childN = rows.filter((r) => r.child).length;
  const capped = ok.filter((o) => o.res.capped);

  const body: string[] = [
    `리콜·안전성조사 이력 조회 — "${name}"`,
    `조회 범위: ${services.map((s) => SOURCE_LABEL[s]).join(", ")} (제품명 일부 일치)`,
  ];
  if (failed.length > 0) {
    body.push(
      partialNotice(
        failed.map((f) => ({ label: SOURCE_LABEL[f.service], reason: f.error.message, action: f.error.actions[0] })),
      ),
    );
  }
  for (const o of capped) {
    body.push(
      `일부만 조회됨: ${SOURCE_LABEL[o.service]} 응답이 요청당 상한 ${SK_MAX_ROWS.toLocaleString("en-US")}건에 도달했습니다. 제품명을 더 구체적으로 입력하세요.`,
    );
  }
  body.push("");
  if (rows.length === 0) {
    body.push(
      `리콜·안전성조사 이력이 조회되지 않았습니다. ${NOTICE_NO_HISTORY}`,
      zeroResultHint("제품명 일치 이력", [
        "제품명을 줄이거나(예: '유아용 카시트' → '카시트') 다른 표기(띄어쓰기, 영문·한글)로 다시 조회하세요.",
        "브랜드·모델명은 결과가 없을 수 있으니 제품 종류 이름으로 조회하세요.",
        "제품안전정보센터 사이트(https://www.safetykorea.kr)에서 직접 확인하세요.",
      ]),
    );
  } else {
    body.push(
      `제품명 일치 ${rows.length}건(어린이제품 가능성 ${childN}건 · 어린이제품 여부 불명 ${rows.length - childN}건), 공표일 최신순.`,
      NOTICE_CHILD,
    );
    if (rows.some((r) => r.service === "certificationList")) body.push(NOTICE_KC);
    body.push("", summarizeList(rows, { limit: args.limit ?? DEFAULT_LIMIT, unit: "건", line }));
  }

  ctx.log.debug("recall", { services: services.length, failed: failed.length, rows: rows.length });

  const footer = composeFooter([
    sourceFooter(
      services.map((s): SourceRef => ({ title: SK_SPECS[s].title, attribution: ATTRIBUTION, datasetUrl: SITE_URL })),
      formatKstMinute(ctx.clock.now()),
    ),
    DISCLAIMER_RECALL,
    NOTICE_SOURCE,
  ]);

  return { body: body.join("\n"), footer };
}

const def: ToolDef<typeof schema> = {
  name: "check_recall",
  title: "어린이제품 리콜 이력 조회(제품안전정보센터 Open API)",
  description:
    "제품명 일부로 제품안전정보센터(SafetyKorea) Open API의 국내 리콜·국외 리콜·해외직구 안전성조사(선택 시 KC 인증) 기록을 조회해 출처 구분·제품명·업체·공표일·사유·조치를 공표일 최신순으로 요약하고, 어린이 관련 키워드로 어린이제품 가능성을 표시합니다. 리콜 여부나 구매 가부를 판단하지 않으며, 리콜 기록을 찾지 못한 제품도 사용 전에 제조사·판매처 안내를 함께 확인해 주세요. 제품안전정보센터 서비스 ID(SAFETYKOREA_AUTH_KEY)가 필요한 참고 도구입니다.",
  schema,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  requiredKeys: ["SAFETYKOREA"],
  handler,
};

export const checkRecallTool = def as unknown as ToolDef;
