import type { BasisDoc } from "../../data-store/schema.js";

export const DISCLAIMER_MEDICAL_LEGAL = "의료·법률 면책: 이 결과는 일반 정보이며 의학적 진단이나 법률 자문이 아닙니다. 검진·접종 시기는 의료진과, 신고·신청 기한과 요건은 관할 기관과 확인하세요.";

export const NOTICE_UNOFFICIAL = "비공식 도구 고지: 이 서버는 정부·공공기관의 공식 서비스가 아닙니다. 최종 확인은 공식 기관(정부24, 복지로, 국민건강보험공단, 관할 주민센터·보건소)에서 하세요.";

export const NOTICE_NO_REVISION_CHECK = "개정 여부 자동 확인은 아직 제공하지 않습니다. 아래 원문 링크에서 최신 개정 여부를 확인하세요.";

export const VERIFIED_LABEL = { full: "검증됨", partial: "부분 검증", false: "미검증" } as const satisfies Record<"full" | "partial" | "false", string>;

export function verifiedText(v: "full" | "partial" | "false" | undefined): string {
  return v === undefined ? "검증 상태 미기재" : VERIFIED_LABEL[v];
}

export function basisLine(doc: BasisDoc): string {
  const dates: string[] = [doc.doc_no];
  if (doc.promulgated !== undefined) dates.push(`공포 ${doc.promulgated}`);
  if (doc.amended !== undefined) dates.push(`개정 ${doc.amended}`);
  if (doc.effective !== undefined) dates.push(`시행 ${doc.effective}`);
  return `- [${doc.id}] ${doc.title} (${dates.join(", ")}) · 기준일 ${doc.as_of} · ${verifiedText(doc.verified)} · ${doc.url}`;
}

export function basisFooter(docs: readonly BasisDoc[]): string {
  if (docs.length === 0) return ["근거 문서: 없음", NOTICE_NO_REVISION_CHECK].join("\n");
  return ["근거 문서:", NOTICE_NO_REVISION_CHECK, ...docs.map(basisLine)].join("\n");
}

export function composeFooter(sections: readonly (string | undefined)[]): string {
  return "---\n" + sections.filter((s): s is string => s !== undefined && s.trim() !== "").join("\n");
}
