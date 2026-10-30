import type { ToolDef } from "../../src/tools/registry.js";

export type ToolGroup = "일정" | "병원·약" | "지원·제도" | "시설" | "안전";

export const GROUP_ORDER: readonly ToolGroup[] = ["일정", "병원·약", "지원·제도", "시설", "안전"];

export const GROUP_TITLES: Record<ToolGroup, string> = {
  일정: "일정",
  "병원·약": "병원·약",
  "지원·제도": "지원·제도",
  시설: "어린이집·유치원",
  안전: "안전",
};

export const TOOL_LABELS: Readonly<Record<string, { plain: string; group: ToolGroup }>> = {
  get_timeline: { plain: "출산·육아 일정 계산", group: "일정" },
  get_leave_article: { plain: "출산·육아 휴가 법 조문", group: "지원·제도" },
  find_night_pediatric: { plain: "밤·휴일 소아 진료 찾기", group: "병원·약" },
  find_benefits: { plain: "임신·육아 지원금 찾기", group: "지원·제도" },
  check_pregnancy_drug: { plain: "임신 중 주의 약 확인", group: "병원·약" },
  check_recall: { plain: "아기 용품 리콜 확인", group: "안전" },
  find_daycare: { plain: "어린이집 찾기 안내", group: "시설" },
  find_vaccination_clinic: { plain: "예방접종 병원 찾기 안내", group: "병원·약" },
  find_checkup_clinic: { plain: "영유아 검진 병원 찾기 안내", group: "병원·약" },
  find_kindergarten: { plain: "유치원 자리 알아보기", group: "시설" },
};

export type SourceKind = "builtin" | "live-key";

export const SOURCE_KIND_TEXT: Record<SourceKind, string> = {
  builtin: "미리 담아 둔 정보",
  "live-key": "공공기관에서 바로 확인",
};

export function sourceKind(t: ToolDef): SourceKind {
  return t.requiredKeys && t.requiredKeys.length > 0 ? "live-key" : "builtin";
}

export function optionalLive(t: ToolDef): boolean {
  return !(t.requiredKeys?.length) && t.annotations.openWorldHint;
}

export function assertLabelsCover(tools: readonly ToolDef[]): void {
  const names = new Set(tools.map((t) => t.name));
  const labelKeys = new Set(Object.keys(TOOL_LABELS));
  const missing = tools.map((t) => t.name).filter((n) => !labelKeys.has(n));
  const extra = Object.keys(TOOL_LABELS).filter((k) => !names.has(k));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(`도구 라벨 불일치: 누락 [${missing}] 잉여 [${extra}]`);
  }
}
