import type { BasisDoc } from "../../data-store/schema.js";
import type { RevisionStatus } from "../../provenance/revision-check.js";

export const DISCLAIMER_MEDICAL_LEGAL = "의료·법률 면책: 이 결과는 일반 정보이며 의학적 진단이나 법률 자문이 아닙니다. 검진·접종 시기는 의료진과, 신고·신청 기한과 요건은 관할 기관과 확인하세요.";

export const NOTICE_UNOFFICIAL = "비공식 도구 고지: 이 서버는 정부·공공기관의 공식 서비스가 아닙니다. 최종 확인은 공식 기관(정부24, 복지로, 국민건강보험공단, 관할 주민센터·보건소)에서 하세요.";

export const NOTICE_VACCINATION_SCOPE = "예방접종 안내 범위: 최소 접종 간격·지연접종(따라잡기)·제품별 세부는 반영하지 않았습니다. 국가예방접종 지침 또는 보건소·의료기관에서 확인하세요.";

export const ESTIMATED_NOTE = "추정: 출산예정일 기준으로 계산한 날짜이며 실제 출생일·진료 일정에 따라 달라집니다.";

export const NOTICE_NO_REVISION_CHECK ="개정 여부 자동 확인은 아직 제공하지 않습니다. 아래 원문 링크에서 최신 개정 여부를 확인하세요.";

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

export function revisionSummary(rs: readonly RevisionStatus[]): string {
  const count = (state: RevisionStatus["state"]): number => rs.filter((r) => r.state === state).length;
  return `개정 확인 요약: 원문 확인 ${count("confirmed")} / 개정됨 ${count("changed")} / 확인 불가 ${count("unavailable")} / 생략 ${count("skipped")}`;
}

export function revisionLine(r: RevisionStatus): string {
  return `  · 개정 확인: ${r.message}` + (r.link ? ` 원문: ${r.link}` : "");
}

export function basisFooter(docs: readonly BasisDoc[], revisions?: readonly RevisionStatus[]): string {
  if (revisions === undefined) {
    if (docs.length === 0) return ["근거 문서: 없음", NOTICE_NO_REVISION_CHECK].join("\n");
    return ["근거 문서:", NOTICE_NO_REVISION_CHECK, ...docs.map(basisLine)].join("\n");
  }
  if (docs.length === 0) return "근거 문서: 없음";
  return [
    "근거 문서:",
    revisionSummary(revisions),
    ...docs.flatMap((d) => {
      const found = revisions.find((r) => r.basisId === d.id);
      return found !== undefined ? [basisLine(d), revisionLine(found)] : [basisLine(d)];
    }),
  ].join("\n");
}

export function composeFooter(sections: readonly (string | undefined)[]): string {
  return "---\n" + sections.filter((s): s is string => s !== undefined && s.trim() !== "").join("\n");
}
