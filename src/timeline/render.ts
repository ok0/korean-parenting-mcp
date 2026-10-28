import { addMonthsClamp, compare, formatDate, type CivilDate } from "../date/civil-date.js";
import { resolveBasis } from "../data-store/load.js";
import type { RevisionStatus } from "../provenance/revision-check.js";
import type { ToolOutput } from "../tools/registry.js";
import {
  DISCLAIMER_MEDICAL_LEGAL,
  ESTIMATED_NOTE,
  NOTICE_UNOFFICIAL,
  NOTICE_VACCINATION_SCOPE,
  basisFooter,
  composeFooter,
  verifiedText,
} from "../tools/shared/format.js";
import type { LocalGuidanceSection, TimelineItem, TimelineMode, TimelineResult } from "./types.js";

export interface TimelineView {
  birthDate: CivilDate;
  referenceDate: CivilDate;
  monthsAhead: number;
  includePast: boolean;
  holidaySource: string;
  mode?: TimelineMode;
}

export function periodText(item: TimelineItem): string {
  const s = formatDate(item.start);
  if (item.end !== undefined && compare(item.end, item.start) !== 0) {
    return `${s} ~ ${formatDate(item.end)}`;
  }
  return s;
}

export function renderItemLine(item: TimelineItem): string {
  const head = `- [${item.status}] ${periodText(item)} | ${item.title} | ${item.nature} | 출처 ${item.provenance.basis_ids.join(", ")} | 기준일 ${item.provenance.as_of} | ${verifiedText(item.provenance.verified)}`;
  const notes = item.estimated === true ? [...item.notes, ESTIMATED_NOTE] : item.notes;
  return [head, ...notes.map((note) => `\n  · ${note}`)].join("");
}

export function renderLocalSection(s: LocalGuidanceSection): string {
  const head =
    s.region !== undefined
      ? `${s.title} (입력 지역: ${s.region}, 지역명은 확인하지 않은 입력 문구 그대로):`
      : `${s.title}:`;
  const out: string[] = [head];
  if (s.missingNote !== undefined) out.push(s.missingNote);
  for (const l of s.lines) {
    out.push(
      `- ${l.title}: ${l.text} 확인처: ${l.contact}${l.url !== undefined ? ` (${l.url})` : ""} | 출처 ${l.provenance.basis_ids.join(", ")} | 기준일 ${l.provenance.as_of} | ${verifiedText(l.provenance.verified)}`,
    );
  }
  return out.join("\n");
}

export function footerBasisIds(result: TimelineResult, local?: LocalGuidanceSection): string[] {
  return [...new Set([...result.basisIds, ...(local?.basisIds ?? [])])];
}

export function renderTimeline(
  result: TimelineResult,
  view: TimelineView,
  local?: LocalGuidanceSection,
  revisions?: readonly RevisionStatus[],
): ToolOutput {
  const horizon = addMonthsClamp(view.referenceDate, view.monthsAhead);
  const count = (status: string): number => result.items.filter((it) => it.status === status).length;
  const summary = `상태 요약: 진행 중 ${count("진행 중")} · 임박 ${count("임박")} · 예정 ${count("예정")}${view.includePast ? ` · 지난 ${count("지난")}` : ""}`;

  const lines: string[] = [
    view.mode === "pregnant"
      ? `육아 타임라인(임신 중) — 출산예정일 ${formatDate(view.birthDate)}, 기준일 ${formatDate(view.referenceDate)}`
      : `육아 타임라인 — 출생일 ${formatDate(view.birthDate)}, 기준일 ${formatDate(view.referenceDate)}`,
    `표시 범위: 시작일이 ${formatDate(horizon)} 이전인 항목(months_ahead=${view.monthsAhead}), 지난 항목 ${view.includePast ? "포함" : "제외"}`,
    summary,
    ...result.notices.map((n) => `안내: ${n}`),
    "",
  ];
  if (result.items.length === 0) {
    lines.push("표시할 항목이 없습니다. 지난 항목은 include_past=true, 더 먼 일정은 months_ahead(최대 156)를 늘려 다시 호출하세요.");
  } else {
    lines.push(...result.items.map(renderItemLine));
  }
  if (result.hiddenPast > 0) {
    lines.push(`지난 항목 ${result.hiddenPast}개 숨김(include_past=true로 표시)`);
  }
  if (result.hiddenFuture > 0) {
    lines.push(`먼 미래 항목 ${result.hiddenFuture}개 숨김(months_ahead를 늘리면 표시, 최대 156)`);
  }

  const footerCore = composeFooter([
    basisFooter(resolveBasis(footerBasisIds(result, local)), revisions),
    `공휴일: ${view.holidaySource}`,
    result.warnings.length > 0 ? ["주의:", ...result.warnings.map((w) => `- ${w}`)].join("\n") : undefined,
    result.items.some((it) => it.category === "접종") ? NOTICE_VACCINATION_SCOPE : undefined,
    DISCLAIMER_MEDICAL_LEGAL,
    NOTICE_UNOFFICIAL,
  ]);
  const footer = local ? `${renderLocalSection(local)}\n\n${footerCore}` : footerCore;

  return { body: lines.join("\n"), footer };
}
