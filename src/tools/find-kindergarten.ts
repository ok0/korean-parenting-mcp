import { z } from "zod";
import { callKindergartenBasic, KG_SITE_URL } from "../clients/kindergarten.js";
import { formatKstMinute } from "../clients/holiday-resolve.js";
import type { ToolContext } from "../core/context.js";
import {
  compareKg,
  estimate,
  estimateText,
  KG_AGES,
  latestByKinder,
  roundLabel,
  roundsOf,
  toKgRow,
  vacancy,
  vacancyText,
  type KgAge,
  type KgRow,
  type Seats,
} from "../kindergarten/summarize.js";
import { kindergartenQuery, normalizeRegion, type Region } from "../region/normalize.js";
import type { ToolDef, ToolOutput } from "./registry.js";
import { NOTICE_SOURCE, composeFooter, sourceFooter, summarizeList } from "./shared/format.js";
import { intField, keywordField, regionField } from "./shared/schema.js";

const DEFAULT_LIMIT = 10;
const SOURCE = { title: "유치원 일반현황(basicInfo2)", attribution: "유치원알리미", datasetUrl: KG_SITE_URL };
const NOTICE_ESTIMATE =
  "빈자리 추정 안내: 여석은 공시 기준 추정치(정원 − 현원)이며 실시간 모집·대기 현황이 아닙니다. 입학·추가모집은 해당 유치원에 확인하세요.";
const NOTICE_CONFIRM = "공시 기준이며 최신 정원·모집 현황은 유치원·교육청·유치원알리미에서 확인하세요.";
const ZERO_TEXT = "해당 시군구에 조회된 유치원 없음 또는 공시 차수 부재(오류 아님).";

const schema = z.object({
  region: regionField({
    purpose: "유치원을 조회할 지역(시군구 단위, 동 단위 불가). 구가 있는 시는 구까지 입력합니다.",
    format: "시도·시군구 이름 1~40자, 시도 생략 가능",
    example: "성동구, 수원 영통구",
  }),
  age: intField(
    {
      purpose: "기준 연령반(만 나이). 지정하면 해당 연령반 여석 추정이 많은 순으로 정렬하고 강조합니다.",
      format: "정수 3, 4, 5 중 하나(숫자 문자열 허용), 생략 시 연령반 합계 기준",
      example: "4",
    },
    { min: 3, max: 5 },
  ).optional(),
  establish: keywordField(
    {
      purpose: "설립유형 필터(응답의 설립유형 값에 부분 일치).",
      format: "1~10자 문자열(공립, 사립, 공립(병설) 등)",
      example: "공립",
    },
    { max: 10 },
  ).optional(),
  limit: intField(
    {
      purpose: "표시할 유치원 수.",
      format: "정수 1~30(숫자 문자열 허용), 기본 10",
      example: "10",
    },
    { min: 1, max: 30 },
  ).optional(),
});

function compact(s: string): string {
  return s.normalize("NFKC").replace(/\s+/g, "");
}

function fmt(c: number | undefined): string {
  return c === undefined ? "정보 없음" : String(c);
}

function seatsText(s: Seats): string {
  return `정원 ${fmt(s.capacity)} · 현원 ${fmt(s.enrolled)} · 학급 ${fmt(s.classes)}`;
}

function guidance(message: string, candidates: readonly Region[]): ToolOutput {
  let body = `지역을 확인해 주세요: ${message}`;
  if (candidates.length > 0) {
    body +=
      "\n후보:\n" +
      candidates.map((c) => `- ${c.sido} ${c.sigungu ?? ""}`.trim()).join("\n") +
      "\n후보 중 하나를 region으로 다시 조회하세요.";
  }
  return { body, footer: composeFooter([NOTICE_SOURCE]) };
}

function line(latest: string | undefined, age?: KgAge): (row: KgRow, i: number) => string {
  return (row, i) => {
    const older = latest !== undefined && row.round !== latest ? " · 이전 차수 기준" : "";
    const out: string[] = [
      `${i + 1}. ${row.name} · ${row.establish ?? "설립유형 정보 없음"} · ${roundLabel(row.round)}${older}`,
      `   주소: ${row.addr ?? "정보 없음"} · 전화: ${row.tel ?? "정보 없음"}`,
    ];
    for (const a of KG_AGES) {
      const s = row.ages[a];
      out.push(
        `   만${a}세${age === a ? "(기준)" : ""}: ${seatsText(s)} → ${vacancyText(vacancy(s.capacity, s.enrolled))}`,
      );
    }
    const extra = [row.mixed.capacity, row.mixed.enrolled, row.mixed.classes, row.special.capacity, row.special.enrolled, row.special.classes];
    if (extra.some((v) => v !== undefined && v > 0)) {
      out.push(`   혼합반: ${seatsText(row.mixed)} / 특수학급: ${seatsText(row.special)} (연령반 추정에서 제외)`);
    }
    out.push(
      `   인가 총정원 ${fmt(row.totalCapacity)} · 현원 합계 ${fmt(row.totalEnrolled)} · ${estimateText(estimate(row))}`,
    );
    if (row.homepage !== undefined) out.push(`   홈페이지: ${row.homepage}`);
    return out.join("\n");
  };
}

async function handler(args: z.output<typeof schema>, ctx: ToolContext): Promise<ToolOutput> {
  const r = normalizeRegion(args.region);
  if (!r.ok) return guidance(r.message, r.candidates);

  const q = kindergartenQuery(r.region);
  if (!q.ok) {
    if (q.reason === "sido-only") {
      return guidance("시도 단위로는 조회하지 않습니다. 시군구 이름을 함께 입력하세요(예: 서울 성동구, 수원 영통구).", []);
    }
    if (q.candidates.length > 0) {
      return guidance(`${q.label}은(는) 유치원알리미 지역 코드표에 없어 구 단위로 조회합니다. 아래 구 중 하나를 골라 주세요.`, q.candidates);
    }
    return guidance(`${q.label}의 유치원알리미 지역 코드를 찾지 못했습니다. 인접 시군구 이름으로 다시 조회하세요.`, []);
  }

  const res = await callKindergartenBasic({ sidoCode: q.sidoCode, sggCode: q.sggCode }, ctx);
  const parsed = res.items.map((item) => toKgRow(item));
  const named = parsed.filter((x): x is KgRow => x !== undefined);
  const skipped = parsed.length - named.length;
  const { rows: uniq } = latestByKinder(named);
  const rounds = roundsOf(uniq);
  const latest = rounds[0];
  const older = uniq.filter((x) => latest !== undefined && x.round !== latest).length;

  const want = args.establish !== undefined ? compact(args.establish) : undefined;
  const shown = want ? uniq.filter((x) => compact(x.establish ?? "").includes(want)) : uniq;
  const excluded = uniq.length - shown.length;
  const age = args.age as KgAge | undefined;
  shown.sort(compareKg(age));

  const head =
    `유치원 일반현황(유치원알리미 공시 정보) — 지역 ${q.label}` +
    (age !== undefined ? ` · 기준 연령 만${age}세` : "") +
    (args.establish !== undefined ? ` · 설립유형 "${args.establish}" 포함` : "");
  const lines: string[] = [head];

  if (uniq.length === 0) {
    lines.push(
      ZERO_TEXT,
      "- 구가 있는 시는 구 이름까지 넣어 다시 조회하세요(예: 수원 영통구).",
      `- 유치원알리미 사이트(${KG_SITE_URL})에서 직접 확인하세요.`,
    );
  } else {
    lines.push(
      `조회 ${res.items.length}건 → 유치원 ${uniq.length}곳(같은 유치원은 가장 최근 공시 차수 1건만 사용)` +
        (excluded > 0 ? ` · 설립유형 조건으로 ${excluded}곳 제외` : ""),
    );
    lines.push(
      `공시 차수: ${roundLabel(latest)} 기준` +
        (older > 0 ? ` · 일부 유치원은 이전 차수 기준 포함(${older}곳, 각 항목에 차수 표시)` : ""),
    );
    lines.push(
      `정렬: ${age !== undefined ? `만${age}세 여석 추정` : "연령반 합계 여석 추정"} 많은 순(산출 불가는 마지막, 같으면 이름순). 여석은 공시 기준 추정치이며 실시간 현황이 아닙니다(아래 고지 참고).`,
    );
    if (res.suspectCapped) {
      lines.push(
        `일부만 조회되었을 수 있음: 응답이 ${res.items.length}건으로 한 번에 받을 수 있는 건수의 상한일 수 있습니다. 전체 목록은 유치원알리미 사이트(${KG_SITE_URL})에서 확인하세요.`,
      );
    }
    if (skipped > 0) lines.push(`이름이 없는 항목 ${skipped}건은 제외했습니다.`);
    lines.push("");
    if (shown.length === 0) {
      lines.push(
        `설립유형 "${args.establish}"에 맞는 유치원이 없습니다(오류 아님). establish를 빼거나 공립·사립으로 바꿔 다시 조회하세요.`,
      );
    } else {
      lines.push(summarizeList(shown, { limit: args.limit ?? DEFAULT_LIMIT, unit: "곳", line: line(latest, age) }));
    }
  }

  const footer = composeFooter([
    sourceFooter([SOURCE], formatKstMinute(ctx.clock.now())),
    rounds.length > 0 ? `공시 차수: ${rounds.map((x) => roundLabel(x)).join(", ")}` : "공시 차수: 조회된 항목 없음",
    NOTICE_ESTIMATE,
    NOTICE_CONFIRM,
    NOTICE_SOURCE,
  ]);
  return { body: lines.join("\n"), footer };
}

const def: ToolDef<typeof schema> = {
  name: "find_kindergarten",
  title: "유치원 정원·현원·여석 추정 조회(유치원알리미 공시 정보)",
  description:
    "유치원알리미 일반현황 공시 정보(OpenAPI)를 시군구 단위로 실시간 조회해 유치원별 설립유형·주소·전화·공시 차수와 만3·4·5세 연령반 정원·현원·학급수, 정원에서 현원을 뺀 여석 추정치를 요약합니다. 여석은 공시 기준 추정치이며 실시간 모집·대기 현황이 아니므로 입학·추가모집은 해당 유치원에 확인하세요. 입학 신청을 대행하지 않는 비공식 참고 도구이며 유치원알리미 인증키(KINDERGARTEN_API_KEY)가 필요합니다.",
  schema,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  requiredKeys: ["KINDERGARTEN"],
  handler,
};

export const findKindergartenTool = def as unknown as ToolDef;
