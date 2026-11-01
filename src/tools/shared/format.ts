import type { BasisDoc } from "../../data-store/schema.js";
import type { RevisionStatus } from "../../provenance/revision-text.js";
import { SOURCE_NOTICE } from "../../core/notice.js";

export const DISCLAIMER_MEDICAL_LEGAL = "의료·법률 면책: 이 결과는 일반 정보이며 의학적 진단이나 법률 자문이 아닙니다. 검진·접종 시기는 의료진과, 신고·신청 기한과 요건은 관할 기관과 확인하세요.";

export const DISCLAIMER_DRUG = "의약품 면책: 식약처 DUR 임부금기 공개 정보를 옮긴 참고 정보이며 진단·처방이나 복용 판단이 아닙니다. 복용 중이거나 복용을 고려 중이면 의료진·약사와 상담하고, 임의로 판단하거나 중단하지 마세요. 목록에 없다는 것이 안전하다는 뜻은 아닙니다.";

export const NOTICE_SOURCE = `${SOURCE_NOTICE} 정부24·복지로·국민건강보험공단·관할 주민센터·보건소에서 확인할 수 있어요.`;

export const NOTICE_VACCINATION_SCOPE = "예방접종 안내 범위: 최소 접종 간격·지연접종(따라잡기)·제품별 세부는 반영하지 않았습니다. 국가예방접종 지침 또는 보건소·의료기관에서 확인하세요.";

export const ESTIMATED_NOTE = "추정: 출산예정일 기준으로 계산한 날짜이며 실제 출생일·진료 일정에 따라 달라집니다.";

export const VERIFIED_LABEL = { full: "전체 검증", partial: "부분 검증", false: "미검증" } as const satisfies Record<"full" | "partial" | "false", string>;

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
    if (docs.length === 0) return "근거 문서: 없음";
    return ["근거 문서:", ...docs.map(basisLine)].join("\n");
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

export interface SourceRef { title: string; attribution: string; datasetUrl: string }

export function sourceFooter(specs: readonly SourceRef[], checkedAtKst: string): string {
  const groups = new Map<string, { attribution: string; datasetUrl: string; titles: string[] }>();
  for (const s of specs) {
    const key = `${s.attribution}\u0000${s.datasetUrl}`;
    const g = groups.get(key);
    if (g === undefined) groups.set(key, { attribution: s.attribution, datasetUrl: s.datasetUrl, titles: [s.title] });
    else g.titles.push(s.title);
  }
  const parts = [...groups.values()].map((g) => {
    if (g.titles.length === 1) return `${g.attribution} — ${g.titles[0]} (${g.datasetUrl})`;
    return `${g.attribution} — ${g.titles.join("; ")} (${g.datasetUrl})`;
  });
  return "출처: " + parts.join("; ") + ` · 조회 시각 ${checkedAtKst} KST`;
}

export function summarizeList<T>(
  rows: readonly T[],
  opts: { limit: number; line: (row: T, index: number) => string; total?: number; unit?: string },
): string {
  const shown = rows.slice(0, opts.limit);
  const total = opts.total ?? rows.length;
  const unit = opts.unit ?? "건";
  const tail =
    total > shown.length
      ? `전체 후보 ${total}${unit} 중 상위 ${shown.length}${unit} 표시(나머지 ${total - shown.length}${unit} 생략)`
      : `전체 후보 ${total}${unit} 모두 표시`;
  if (shown.length === 0) return tail;
  const lines = shown.map((r, i) => opts.line(r, i)).join("\n\n");
  return lines + "\n\n" + tail;
}

export function zeroResultHint(what: string, suggestions: readonly string[]): string {
  return `${what} 조회 결과가 없습니다(오류 아님). 다음을 시도해 보세요:\n` + suggestions.map((s) => `- ${s}`).join("\n");
}

export function partialNotice(failed: readonly { label: string; reason: string; action?: string }[]): string {
  if (failed.length === 0) return "";
  return (
    "일부 결과만 표시합니다:\n" +
    failed
      .map((f) => `- ${f.label} 조회 실패: ${f.reason}` + (f.action ? ` 조치: ${f.action}` : ""))
      .join("\n")
  );
}
