import type { ToolResult } from "../core/errors.js";
import { KEY_GUIDE } from "../core/errors.js";
import type { ToolDef } from "../tools/registry.js";
import { NOTICE_UNOFFICIAL } from "../tools/shared/format.js";
import { SERVER_INSTRUCTIONS } from "../server/instructions.js";

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

export const REMOTE_POLICY: readonly RemotePolicy[] = [
  {
    tool: "get_timeline",
    expose: true,
    providers: ["kasi", "moleg"],
    verdict: "허용(추정)",
    conditions: ["법제처 출처·개정 확인 footer 유지"],
    confirmation: { kasi: "not-asked", moleg: "not-asked" },
  },
  {
    tool: "get_leave_article",
    expose: true,
    providers: ["moleg"],
    verdict: "조건부 허용",
    conditions: [
      "출처 \"법제처 국가법령정보센터\" 표시",
      "조문 본문 원문 무변경",
      "운영 서버 IP의 법제처 등록이 확인되지 않으면 expose=false(M24)",
    ],
    confirmation: { moleg: "not-asked" },
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
];

export const REMOTE_EXCLUDED_HEADING = "## 원격 모드에서 제공하지 않는 기능";

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
    if (!names.has(p.tool)) out.push(`${p.tool}: 등록된 도구가 아닙니다`);
    if (p.verdict === "불명확" && p.expose) {
      for (const prov of p.providers) {
        if (p.confirmation[prov] !== "allowed") {
          out.push(`${p.tool}: 판정 불명확인데 노출되며 ${prov} 서면 확인이 allowed가 아닙니다`);
        }
      }
    }
    if (p.expose && Object.values(p.confirmation).includes("denied")) {
      out.push(`${p.tool}: 거부된 제공처가 있는데 노출되어 있습니다`);
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

export function remoteTools(all: readonly ToolDef[], policy: readonly RemotePolicy[] = REMOTE_POLICY): ToolDef[] {
  return all.filter((t) => policy.find((p) => p.tool === t.name)?.expose === true);
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
    NOTICE_UNOFFICIAL,
  ].join("\n");
  return { content: [{ type: "text", text }] };
}

export function buildRemoteInstructions(policy: readonly RemotePolicy[] = REMOTE_POLICY): string {
  const rows = policy.flatMap((p) => (p.expose || !p.replacement ? [] : [{ tool: p.tool, replacement: p.replacement }]));
  if (rows.length === 0) return SERVER_INSTRUCTIONS;
  return `${SERVER_INSTRUCTIONS}\n\n${REMOTE_EXCLUDED_HEADING}\n${rows
    .map((r) => `- ${r.tool}: ${r.replacement.summary} (${r.replacement.links.map((l) => `${l.title} ${l.url}`).join(", ")})`)
    .join("\n")}`;
}
