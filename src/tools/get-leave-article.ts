import { z } from "zod";
import { createLawClient, normName, toJo } from "../clients/law.js";
import type { ToolContext } from "../core/context.js";
import { ToolError } from "../core/errors.js";
import { loadData, resolveBasis } from "../data-store/load.js";
import type { ToolDef, ToolOutput } from "./registry.js";
import { NOTICE_UNOFFICIAL, composeFooter, verifiedText } from "./shared/format.js";
import { enumField } from "./shared/schema.js";

const ARTICLE_TEXT_MAX = 4000;
const NOTICE_LEGAL_ARTICLE =
  "법률 면책: 조문 원문을 옮긴 참고 정보로 법적 효력이 없고 법률 자문이 아닙니다. 적용 여부와 세부 요건은 법령 원문·사업장·고용센터(고용노동부)에 확인하세요.";
const SOURCE_NAME = "법제처 국가법령정보센터";

const schema = z.object({
  topic: enumField(["spouse_leave", "maternity_leave", "parental_leave"] as const, {
    purpose:
      "조회할 휴가 종류. spouse_leave=배우자 출산휴가(남녀고용평등법), maternity_leave=출산전후휴가(근로기준법), parental_leave=육아휴직(남녀고용평등법)",
    format: "spouse_leave, maternity_leave, parental_leave 중 하나",
    example: "maternity_leave",
  }),
});

function kst(d: Date): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

function ymd(v: string): string {
  return /^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : v;
}

function footerOf(ctx: ToolContext, url: string): string {
  return composeFooter([
    `출처: ${SOURCE_NAME} (조회 시각 ${kst(ctx.clock.now())} KST) · 원문 ${url}`,
    NOTICE_LEGAL_ARTICLE,
    NOTICE_UNOFFICIAL,
  ]);
}

function guidance(
  ctx: ToolContext,
  what: string,
  lawName: string,
  label: string,
  url: string,
): ToolOutput {
  return {
    body:
      `법제처 조회에서 ${what}을(를) 찾지 못했습니다: ${lawName} ${label}\n` +
      `대안: 법제처 국가법령정보센터(https://www.law.go.kr)에서 법령명 '${lawName}'으로 검색해 ${label}을 확인하세요. 원문: ${url}`,
    footer: footerOf(ctx, url),
  };
}

async function handler(args: z.output<typeof schema>, ctx: ToolContext): Promise<ToolOutput> {
  const a = loadData("leave").articles[args.topic];
  const doc = resolveBasis(a.basis_ids)[0];
  if (doc?.law_api?.kind !== "law") {
    throw new ToolError("INTERNAL", "근거 조문 데이터 오류");
  }
  const lawName = doc.law_api.law_name;
  const url = doc.url;
  const label = `제${a.article}조${a.branch > 0 ? `의${a.branch}` : ""}`;

  const client = createLawClient(ctx);
  const lawId =
    doc.law_api.law_id ??
    (await client.searchLaw(lawName)).find((r) => r.name !== undefined && normName(r.name) === normName(lawName))
      ?.lawId;
  if (lawId === undefined) return guidance(ctx, "법령 ID", lawName, label, url);

  const art = await client.getArticle(lawId, toJo(a.article, a.branch));
  if (art.lines.length === 0) return guidance(ctx, "조문", lawName, label, url);

  const dateParts: string[] = [];
  if (art.promulgated !== undefined) dateParts.push(`공포일자 ${ymd(art.promulgated)}`);
  if (art.effective !== undefined) dateParts.push(`시행일자 ${ymd(art.effective)}`);
  if (art.articleEffective !== undefined) dateParts.push(`조문시행일자 ${ymd(art.articleEffective)}`);

  const header = [
    `근거 조문: ${lawName} ${label}${art.title !== undefined ? `(${art.title})` : ""}`,
    `조 번호 데이터: ${verifiedText(a.verified)} — ${a.note}`,
    ...(dateParts.length > 0 ? [dateParts.join(", ")] : []),
  ];

  let content = art.lines.join("\n");
  if (content.length > ARTICLE_TEXT_MAX) {
    content =
      content.slice(0, ARTICLE_TEXT_MAX) + `\n…(조문 일부 생략: 전체 내용은 원문 링크에서 확인하세요 ${url})`;
  }

  return {
    body: [...header, "", content].join("\n"),
    footer: footerOf(ctx, url),
  };
}

const def: ToolDef<typeof schema> = {
  name: "get_leave_article",
  title: "출산·육아 휴가 근거 법 조문 조회(법제처)",
  description:
    "배우자 출산휴가·출산전후휴가·육아휴직의 근거 법 조문(법령명, 조 번호와 제목, 항·호 내용, 공포·시행일)을 법제처 국가법령정보 Open API에서 조회해 보여줍니다. 법제처 OC(LAW_OC)가 필요합니다. 조문 해석이나 법률 자문은 제공하지 않으며 결과는 참고용입니다.",
  schema,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  requiredKeys: ["LAW_OC"],
  handler,
};

export const getLeaveArticleTool = def as unknown as ToolDef;
