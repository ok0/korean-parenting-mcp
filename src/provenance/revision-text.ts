import type { BasisDoc } from "../data-store/schema.js";

export type RevisionState = "confirmed" | "changed" | "unavailable" | "skipped";
export type UnavailableReason = "no_baseline" | "not_found" | "ambiguous" | "deadline" | "timeout" | "failed" | "bad_response" | "not_approved";

export interface RevisionStatus {
  basisId: string;
  state: RevisionState;
  message: string;
  reason?: UnavailableReason;
  link?: string;
  attachment?: { pdfLink?: string; fileLink?: string };
  stored?: Record<string, string>;
  current?: Record<string, string>;
}

export const REVISION_TEXT = {
  skippedNoOc: "법제처 OC 미설정: 개정 여부 확인 생략",
  skippedNoApi: "자동 확인 대상 외",
  skippedRemote: "개정 여부 확인 불가(원격)",
  confirmed: "원문 확인됨",
  changed: "근거가 개정되었습니다. 원문을 확인하세요",
  unavailable: "개정 여부 확인 불가",
} as const;

export const UNAVAILABLE_TEXT: Record<UnavailableReason, string> = {
  no_baseline: "비교 기준 미등록",
  not_found: "조회 결과에 대상 없음",
  ambiguous: "같은 이름 행정규칙이 여러 건",
  deadline: "확인 시간 초과",
  timeout: "법제처 응답 시간 초과",
  failed: "법제처 조회 실패",
  bad_response: "응답 형식 오류",
  not_approved: "법제처 사용자 정보 검증 실패(OC·IP 등록 확인)",
};

export function skippedStatus(basisId: string, message: string, link?: string): RevisionStatus {
  return { basisId, state: "skipped", message, ...(link !== undefined ? { link } : {}) };
}

export function keylessStatus(doc: Pick<BasisDoc, "id" | "law_api">): RevisionStatus {
  return skippedStatus(doc.id, doc.law_api === null ? REVISION_TEXT.skippedNoApi : REVISION_TEXT.skippedNoOc);
}
