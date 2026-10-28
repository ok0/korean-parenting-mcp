import { z } from "zod";
import { callDataGoKr } from "../clients/data-go-kr.js";
import { DUR_NUM_OF_ROWS, SPECS } from "../clients/data-go-kr-specs.js";
import { formatKstMinute } from "../clients/holiday-resolve.js";
import type { ToolContext } from "../core/context.js";
import type { ToolDef, ToolOutput } from "./registry.js";
import { DISCLAIMER_DRUG, NOTICE_UNOFFICIAL, composeFooter, sourceFooter, summarizeList, zeroResultHint } from "./shared/format.js";
import { intField, keywordField } from "./shared/schema.js";

const DEFAULT_LIMIT = 5;
const CONTENT_MAX = 200;
const REMARK_MAX = 120;
const NOTICE_COMBO =
  "금기 성분은 임부금기로 지정된 성분입니다. 복합제는 검색한 성분이 아닌 다른 성분이 금기 대상일 수 있습니다.";
const NOTICE_NOT_FOUND = "DUR 임부금기 목록에서 이 이름을 찾지 못했습니다. 찾지 못했다는 것이 안전하다는 뜻은 아닙니다.";
const NOTICE_SCOPE = `조회 범위: 이름 검색 결과의 첫 페이지(최대 ${DUR_NUM_OF_ROWS ?? 10}건)만 받습니다. 상품명보다 성분명 검색이 잘 맞습니다.`;

const schema = z.object({
  drug_name: keywordField(
    {
      purpose: "임부금기 여부를 찾아볼 약의 이름. 성분명(예: 아세트아미노펜) 권장, 상품명은 조회되지 않을 수 있음.",
      format: "2~50자 문자열(앞뒤 공백 제거)",
      example: "아세트아미노펜",
    },
    { min: 2, max: 50 },
  ),
  limit: intField(
    {
      purpose: "요약할 품목 수.",
      format: "1~10 정수(숫자 문자열 허용), 기본 5",
      example: "5",
    },
    { min: 1, max: 10 },
  ).optional(),
});

export function normalizeDrugName(s: string): string {
  return s.normalize("NFKC").trim().replace(/\s+/g, " ");
}

function s(v: unknown): string | undefined {
  if (typeof v !== "string" && typeof v !== "number") return undefined;
  const t = String(v).replace(/\s+/g, " ").trim();
  return t === "" ? undefined : t;
}

function clip(t: string, n: number): string {
  return t.length > n ? t.slice(0, n) + "…" : t;
}

function ymd(v: string | undefined): string | undefined {
  if (v === undefined) return undefined;
  return /^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : v;
}

function dedupe(items: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  const seen = new Set<string>();
  return items.filter((item, index) => {
    const seq = s(item["ITEM_SEQ"]);
    const name = s(item["ITEM_NAME"]);
    const entp = s(item["ENTP_NAME"]);
    const key =
      seq !== undefined
        ? `seq:${seq}`
        : name !== undefined || entp !== undefined
          ? `name:${name ?? ""}|${entp ?? ""}`
          : `#${index}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function ingredientLine(item: Record<string, unknown>): string | undefined {
  const ingr = s(item["INGR_NAME"]);
  const form = s(item["FORM_NAME"]);
  if (ingr === undefined && form === undefined) return undefined;
  const parts: string[] = [];
  if (ingr !== undefined) parts.push(`금기 성분: ${ingr}`);
  if (form !== undefined) parts.push(`제형: ${form}`);
  return `   ${parts.join(" · ")}`;
}

function dateLine(item: Record<string, unknown>): string | undefined {
  const notified = ymd(s(item["NOTIFICATION_DATE"]));
  const changed = ymd(s(item["CHANGE_DATE"]));
  const parts: string[] = [];
  if (notified !== undefined) parts.push(`고시일: ${notified}`);
  if (changed !== undefined) parts.push(`변경일: ${changed}`);
  return parts.length === 0 ? undefined : `   ${parts.join(" · ")}`;
}

function line(item: Record<string, unknown>, i: number): string {
  const lines = [
    `${i + 1}. ${s(item["ITEM_NAME"]) ?? "품목명 정보 없음"} — ${s(item["ENTP_NAME"]) ?? "업체 정보 없음"}`,
  ];
  const ingr = ingredientLine(item);
  if (ingr !== undefined) lines.push(ingr);
  const content = s(item["PROHBT_CONTENT"]);
  lines.push(`   금기 내용: ${content !== undefined ? clip(content, CONTENT_MAX) : "응답에 기재 없음"}`);
  const remark = s(item["REMARK"]);
  if (remark !== undefined) lines.push(`   비고: ${clip(remark, REMARK_MAX)}`);
  const dates = dateLine(item);
  if (dates !== undefined) lines.push(dates);
  return lines.join("\n");
}

async function handler(args: z.output<typeof schema>, ctx: ToolContext): Promise<ToolOutput> {
  const name = normalizeDrugName(args.drug_name);
  const callCtx: ToolContext = {
    ...ctx,
    config: { ...ctx.config, httpTimeoutMs: Math.min(ctx.config.httpTimeoutMs, ctx.config.chainDeadlineMs) },
  };
  const res = await callDataGoKr(SPECS.durPregnancy, { itemName: name, numOfRows: DUR_NUM_OF_ROWS }, callCtx);
  const rows = dedupe(res.items);
  const total = res.totalCount ?? res.items.length;

  const body: string[] = [`DUR 임부금기 조회 — "${name}"`, DISCLAIMER_DRUG, ""];
  if (rows.length === 0) {
    body.push(
      NOTICE_NOT_FOUND,
      zeroResultHint("DUR 임부금기", [
        "상품명(제품 이름)은 조회되지 않을 수 있습니다. 제품 설명서나 포장에 적힌 유효성분(성분명, 예: 아세트아미노펜)으로 다시 조회하세요.",
        "철자와 띄어쓰기를 확인하세요.",
        "복용 중이거나 복용을 고려 중이면 약사·의료진과 상담하세요.",
      ]),
    );
  } else {
    body.push(`식약처 DUR 임부금기 목록에 이 이름으로 조회되는 품목이 있습니다(전체 ${total}건).`, NOTICE_COMBO);
    if (total > res.items.length) {
      body.push(
        `일부만 조회됨: 전체 ${total}건 중 ${res.items.length}건만 받았습니다. 성분명을 더 구체적으로 입력해 범위를 좁히세요.`,
      );
    }
    body.push(
      "",
      summarizeList(rows, { limit: args.limit ?? DEFAULT_LIMIT, unit: "건", line }),
    );
  }

  const footer = composeFooter([
    sourceFooter([SPECS.durPregnancy], formatKstMinute(ctx.clock.now())),
    NOTICE_SCOPE,
    DISCLAIMER_DRUG,
    NOTICE_UNOFFICIAL,
  ]);

  return { body: body.join("\n"), footer };
}

const def: ToolDef<typeof schema> = {
  name: "check_pregnancy_drug",
  title: "임부금기 의약품 정보 조회(식약처 DUR 공공데이터)",
  description:
    "약 이름(성분명 권장)으로 식품의약품안전처 DUR 임부금기 품목 정보를 조회해 품목명·업체·금기 성분·제형·금기 내용·비고·고시일을 요약합니다. 상품명은 조회되지 않을 수 있어 성분명 검색을 권장합니다. 복용 여부나 위험도를 판단하지 않으며 목록에 없다고 안전하다는 뜻이 아닙니다. 복용 전 의료진·약사와 상담하세요. 공공데이터포털 인증키(DATA_GO_KR_SERVICE_KEY)가 필요한 비공식 참고 도구입니다.",
  schema,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  requiredKeys: ["DATA_GO_KR"],
  handler,
};

export const checkPregnancyDrugTool = def as unknown as ToolDef;
