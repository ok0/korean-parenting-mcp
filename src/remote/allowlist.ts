import type { ToolResult } from "../core/errors.js";
import { KEY_GUIDE } from "../core/errors.js";
import { loadData, resolveBasis } from "../data-store/load.js";
import type { ToolDef } from "../tools/registry.js";
import { NOTICE_SOURCE } from "../tools/shared/format.js";
import { SERVER_INSTRUCTIONS } from "../server/instructions.js";
import { REMOTE_INPUT_NOTICE, REMOTE_LAW_NOTICE } from "./privacy.js";

export type Provider = "nemc" | "mois" | "mfds" | "kasi" | "moleg" | "kinder" | "safetykorea";
export type Confirmation = "not-asked" | "asked" | "allowed" | "conditional" | "denied";
export type Verdict = "허용(추정)" | "조건부 허용" | "불명확" | "해당 없음";

export interface RemotePolicy {
  tool: string;
  expose: boolean;
  providers: Provider[];
  verdict: Verdict;
  conditions: string[];
  confirmation: Partial<Record<Provider, Confirmation>>;
  replacement?: { summary: string; links: { title: string; url: string }[] };
  blockedBy?: "ip-registration";
}

export const PROVIDER_LABELS: Record<Provider, string> = {
  nemc: "국립중앙의료원",
  mois: "행정안전부(보조금24)",
  mfds: "식품의약품안전처(DUR)",
  kasi: "한국천문연구원",
  moleg: "법제처",
  kinder: "교육부(유치원알리미)",
  safetykorea: "제품안전정보센터(SafetyKorea)",
};

const LOCAL_LEAVE_SENTENCE =
  " 배우자 출산휴가·출산전후휴가·육아휴직의 근거 법 조문 원문이 필요하면 get_leave_article(LAW_OC 필요)을 사용하세요.";

const DESCRIPTION_REWRITES: Readonly<Record<string, readonly [string, string]>> = {
  get_timeline: [
    "LAW_OC가 설정되어 있으면 근거 문서의 개정 여부를 법제처에서 확인해 함께 표시합니다.",
    "원격 모드는 법제처 조회를 하지 않아 근거 문서마다 \"개정 여부 확인 불가(원격)\"과 원문 링크를 표시합니다.",
  ],
};

function leaveLink(topic: "spouse_leave" | "maternity_leave" | "parental_leave", label: string): { title: string; url: string } {
  const doc = resolveBasis(loadData("leave").articles[topic].basis_ids)[0];
  if (!doc) throw new Error(`leave basis missing: ${topic}`);
  return { title: `${label} 근거: ${doc.title}(국가법령정보센터)`, url: doc.url };
}

export const REMOTE_POLICY: readonly RemotePolicy[] = [
  {
    tool: "get_timeline",
    expose: true,
    providers: ["kasi"],
    verdict: "허용(추정)",
    conditions: ["원격은 법제처 개정 확인 없이 '개정 여부 확인 불가(원격)'·원문 링크 표시"],
    confirmation: { kasi: "not-asked" },
  },
  {
    tool: "get_leave_article",
    expose: false,
    providers: ["moleg"],
    verdict: "조건부 허용",
    conditions: [
      "출처 \"법제처 국가법령정보센터\" 표시",
      "조문 본문 원문 무변경",
      "고정 출구 IP 확보·법제처 IP 등록 전까지 제외(blockedBy: ip-registration)",
    ],
    confirmation: { moleg: "not-asked" },
    replacement: {
      summary:
        "배우자 출산휴가·출산전후휴가·육아휴직 근거 법 조문 원문 조회는 원격 모드에서 제공하지 않습니다. 원격은 고정 출구 IP가 없어 법제처 조회를 하지 않으며 조문 조회는 로컬 모드(npm·.mcpb)에서 가능합니다. 아래 국가법령정보센터 원문에서 해당 조문을 확인하세요.",
      links: [
        leaveLink("spouse_leave", "배우자 출산휴가"),
        leaveLink("maternity_leave", "출산전후휴가"),
        leaveLink("parental_leave", "육아휴직"),
      ],
    },
    blockedBy: "ip-registration",
  },
  {
    tool: "find_night_pediatric",
    expose: true,
    providers: ["nemc"],
    verdict: "허용(추정)",
    conditions: ["출처 표시"],
    confirmation: { nemc: "not-asked" },
  },
  {
    tool: "find_benefits",
    expose: true,
    providers: ["mois"],
    verdict: "허용(추정)",
    conditions: ["출처 표시", "서면 확인 우선 문의"],
    confirmation: { mois: "not-asked" },
  },
  {
    tool: "check_pregnancy_drug",
    expose: true,
    providers: ["mfds"],
    verdict: "허용(추정)",
    conditions: ["출처 표시", "의약품 면책 문구 유지"],
    confirmation: { mfds: "not-asked" },
  },
  {
    tool: "check_recall",
    expose: false,
    providers: ["safetykorea"],
    verdict: "불명확",
    conditions: ["제공처 서면 확인이 allowed가 되기 전까지 제외"],
    confirmation: { safetykorea: "not-asked" },
    replacement: {
      summary: "어린이제품 리콜 이력 조회는 원격 모드에서 제공하지 않습니다. 제품안전정보센터(SafetyKorea)에서 제품명·모델명으로 리콜 정보를 직접 확인하세요. 키를 직접 발급받아 로컬 모드(npm·.mcpb)로 쓰면 이 도구로 조회할 수 있습니다.",
      links: [{ title: "제품안전정보센터(SafetyKorea)", url: KEY_GUIDE.SAFETYKOREA.url }],
    },
  },
  {
    tool: "find_daycare",
    expose: true,
    providers: [],
    verdict: "해당 없음",
    conditions: ["외부 데이터 미호출"],
    confirmation: {},
  },
  {
    tool: "find_vaccination_clinic",
    expose: true,
    providers: [],
    verdict: "해당 없음",
    conditions: ["외부 데이터 미호출"],
    confirmation: {},
  },
  {
    tool: "find_checkup_clinic",
    expose: true,
    providers: [],
    verdict: "해당 없음",
    conditions: ["외부 데이터 미호출"],
    confirmation: {},
  },
  {
    tool: "find_kindergarten",
    expose: true,
    providers: ["kinder"],
    verdict: "조건부 허용",
    conditions: [
      "출처(교육부 유치원알리미·공시 차수) 표시",
      "basicInfo2(영리 포함 자유이용 표기) 자료만 사용",
    ],
    confirmation: { kinder: "not-asked" },
  },
  {
    tool: "find_local_support",
    expose: false,
    providers: [],
    verdict: "해당 없음",
    conditions: ["로컬 전용 선택 기능(ADR-62)"],
    confirmation: {},
    replacement: {
      summary: "우리 지역 육아 지원 서비스 찾기는 내 컴퓨터에서 실행하는 로컬 모드(npm·.mcpb)에서 공공데이터포털 서비스 키를 설정해 쓸 수 있어요. 지역별 복지 서비스는 복지로에서 지역을 골라 직접 찾아볼 수 있어요.",
      links: [{ title: "복지로", url: "https://www.bokjiro.go.kr" }],
    },
  },
];

export const REMOTE_EXCLUDED_HEADING = "## 원격 모드에서 제공하지 않는 기능";
export const REMOTE_PRIVACY_HEADING = "## 원격 모드 개인정보 안내";

export function policyViolations(policy: readonly RemotePolicy[], toolNames: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of policy) {
    if (seen.has(p.tool)) out.push(`${p.tool}: 정책 행이 중복되어 있습니다`);
    seen.add(p.tool);
  }
  const names = new Set(toolNames);
  for (const name of names) {
    if (!seen.has(name)) out.push(`${name}: 원격 정책 행이 없습니다`);
  }
  for (const p of policy) {
    if (!names.has(p.tool)) out.push(`${p.tool}: 정책 행의 도구는 등록된 도구여야 합니다`);
    if (p.verdict === "불명확" && p.expose) {
      for (const prov of p.providers) {
        if (p.confirmation[prov] !== "allowed") {
          out.push(`${p.tool}: 판정 불명확인데 노출되므로 ${prov} 서면 확인은 allowed여야 합니다`);
        }
      }
    }
    if (p.expose && Object.values(p.confirmation).includes("denied")) {
      out.push(`${p.tool}: 거부된 제공처가 있는데 노출되어 있습니다`);
    }
    if (p.blockedBy !== undefined && p.expose) {
      out.push(`${p.tool}: ${p.blockedBy} 차단 사유가 있는데 노출되어 있습니다`);
    }
    if (!p.expose) {
      const r = p.replacement;
      if (!r || r.summary === "" || r.links.length === 0) {
        out.push(`${p.tool}: 제외 도구에 대체 안내가 없습니다`);
      }
    }
    for (const prov of p.providers) {
      if (p.confirmation[prov] === undefined) {
        out.push(`${p.tool}: ${prov} 서면 확인 상태가 없습니다`);
      }
    }
  }
  return out;
}

export const REMOTE_SERVER_INSTRUCTIONS: string = SERVER_INSTRUCTIONS.split("\n")
  .map((l) => (l.startsWith("API 키:") ? `원격 모드: ${REMOTE_LAW_NOTICE}` : l.replace(LOCAL_LEAVE_SENTENCE, "")))
  .join("\n");

function rewrite(name: string, description: string): string {
  const pair = DESCRIPTION_REWRITES[name];
  return pair === undefined ? description : description.replace(pair[0], pair[1]);
}

export function remoteTools(all: readonly ToolDef[], policy: readonly RemotePolicy[] = REMOTE_POLICY): ToolDef[] {
  return all
    .filter((t) => policy.find((p) => p.tool === t.name)?.expose === true)
    .map((t) => ({ ...t, description: `${rewrite(t.name, t.description)}\n\n${REMOTE_INPUT_NOTICE}` }));
}

export function excludedFallback(name: string, policy: readonly RemotePolicy[] = REMOTE_POLICY): ToolResult | undefined {
  const row = policy.find((p) => p.tool === name && !p.expose);
  const r = row?.replacement;
  if (!r) return undefined;
  const text = [
    `[${name}] 원격 모드에서 제공하지 않는 기능입니다.`,
    r.summary,
    ...r.links.map((l) => `- ${l.title}: ${l.url}`),
    "",
    NOTICE_SOURCE,
  ].join("\n");
  return { content: [{ type: "text", text }] };
}

export function buildRemoteInstructions(policy: readonly RemotePolicy[] = REMOTE_POLICY): string {
  const privacy = `${REMOTE_PRIVACY_HEADING}\n${REMOTE_INPUT_NOTICE}\n개인정보 처리방침: 이 서버의 /privacy 경로에서 볼 수 있습니다.`;
  const rows = policy.flatMap((p) => (p.expose || !p.replacement ? [] : [{ tool: p.tool, replacement: p.replacement }]));
  if (rows.length === 0) return `${REMOTE_SERVER_INSTRUCTIONS}\n\n${privacy}`;
  return `${REMOTE_SERVER_INSTRUCTIONS}\n\n${REMOTE_EXCLUDED_HEADING}\n${rows
    .map((r) => `- ${r.tool}: ${r.replacement.summary} (${r.replacement.links.map((l) => `${l.title} ${l.url}`).join(", ")})`)
    .join("\n")}\n\n${privacy}`;
}
