import { addMonthsClamp, compare, formatDate, type CivilDate } from "../date/civil-date.js";
import { resolveBasis } from "../data-store/load.js";
import type { ToolOutput } from "../tools/registry.js";
import {
  DISCLAIMER_MEDICAL_LEGAL,
  NOTICE_UNOFFICIAL,
  basisFooter,
  composeFooter,
  verifiedText,
} from "../tools/shared/format.js";
import type { TimelineItem, TimelineResult } from "./types.js";

export interface TimelineView {
  birthDate: CivilDate;
  referenceDate: CivilDate;
  monthsAhead: number;
  includePast: boolean;
  holidaySource: string;
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
  return [head, ...item.notes.map((note) => `\n  · ${note}`)].join("");
}

export function renderTimeline(result: TimelineResult, view: TimelineView): ToolOutput {
  const horizon = addMonthsClamp(view.referenceDate, view.monthsAhead);
  const count = (status: string): number => result.items.filter((it) => it.status === status).length;
  const summary = `상태 요약: 진행 중 ${count("진행 중")} · 임박 ${count("임박")} · 예정 ${count("예정")}${view.includePast ? ` · 지난 ${count("지난")}` : ""}`;

  const lines: string[] = [
    `육아 타임라인 — 출생일 ${formatDate(view.birthDate)}, 기준일 ${formatDate(view.referenceDate)}`,
    `표시 범위: 시작일이 ${formatDate(horizon)} 이전인 항목(months_ahead=${view.monthsAhead}), 지난 항목 ${view.includePast ? "포함" : "제외"}`,
    summary,
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

  const footer = composeFooter([
    basisFooter(resolveBasis(result.basisIds)),
    `공휴일: ${view.holidaySource}`,
    result.warnings.length > 0 ? ["주의:", ...result.warnings.map((w) => `- ${w}`)].join("\n") : undefined,
    DISCLAIMER_MEDICAL_LEGAL,
    NOTICE_UNOFFICIAL,
  ]);

  return { body: lines.join("\n"), footer };
}
