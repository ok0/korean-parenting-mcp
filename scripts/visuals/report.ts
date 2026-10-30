import {
  compare,
  formatDate,
  lastDayOfMonth,
  makeDate,
  parseDate,
} from "../../src/date/civil-date.js";
import { resolveBasis } from "../../src/data-store/load.js";
import type { TimelineArgs } from "../../src/timeline/input.js";
import { computeOfflineTimeline, type OfflineTimeline } from "../../src/timeline/offline.js";
import { periodText } from "../../src/timeline/render.js";
import type { LocalGuidanceLine, TimelineItem } from "../../src/timeline/types.js";
import { TOOL_LABELS } from "./labels.js";
import { arrow, svgDoc, textBlock, type Theme } from "./theme.js";

export const REPORT_EXAMPLE = {
  due_date: "2027-03-15",
  region: "서울 성동구",
  birth_order: 1,
  fetus_count: 1,
  reference_date: "2026-11-02",
  months_ahead: 12,
  include_past: false,
} as const satisfies TimelineArgs;

export const REPORT_REQUEST = "출산예정일 2027-03-15, 서울 성동구, 첫째, 직장인 — 한 장짜리 준비 보고서로 정리해 줘";

export const REQUEST_LABEL = "AI 도우미에게 보낸 요청(예시)";

export const WORKER_NOTE = "요청의 '직장인'은 일정 계산에 쓰이지 않아요. 휴가 항목은 누구에게나 같은 일반 안내예요.";

export const FALLBACK_LINE = "확인 필요: 이 예시 결과에는 해당 항목이 없어요. 관할 기관에서 확인하세요";

export const MORE_LINE = (n: number): string => `외 ${n}건 더 있어요(전체 일정 응답에서 확인)`;

export const REPORT_DISCLAIMER = "의료·법률 판단이 아닌 일반 안내예요. 진료는 의료진, 제도·기한은 관할 기관에 꼭 확인하세요.";

export const REPORT_BADGE = "예시 · 개인 맞춤 아님 · 비공식 도구";

export const SECTION_HEADINGS = ["이번 달 할 일", "산전검진·예방접종 일정", "받을 수 있는 지원금·신청 마감", "출산·육아휴직 시점", "확인할 곳"] as const;

export const SECTION_CAPS = [4, 6, 6, 3, 4] as const;

export interface ReportSection {
  heading: string;
  lines: string[];
  more: number;
  fallback: boolean;
}

export interface ReportModel {
  asOf: string;
  monthLabel: string;
  sections: ReportSection[];
  dataAsOf: string;
  sources: { law: number; web: number };
  tools: string[];
  facts: string[];
}

type Provenance = TimelineItem["provenance"];

interface Entry {
  line: string;
  facts: string[];
  provenance: Provenance;
}

const itemEntry = (i: TimelineItem): Entry => ({
  line: `${periodText(i)} · ${i.title}`,
  facts: [periodText(i), i.title],
  provenance: i.provenance,
});

const localEntry = (l: LocalGuidanceLine): Entry => ({
  line: `${l.title}: ${l.contact}`,
  facts: [l.title, l.contact],
  provenance: l.provenance,
});

export function reportTimeline(args: TimelineArgs = REPORT_EXAMPLE): OfflineTimeline {
  return computeOfflineTimeline({ ...args }, parseDate(args.reference_date as string));
}

export function buildReportModel(t: OfflineTimeline): ReportModel {
  const ref = t.view.referenceDate;
  const asOf = formatDate(ref);
  const monthLabel = `${ref.y}년 ${ref.m}월`;
  const ms = makeDate(ref.y, ref.m, 1);
  const me = makeDate(ref.y, ref.m, lastDayOfMonth(ref.y, ref.m));
  const byStart = [...t.result.items].sort((a, b) => compare(a.start, b.start));

  const candidates: Entry[][] = [
    byStart
      .filter((i) => i.status !== "지난" && compare(i.start, me) <= 0 && compare(i.end ?? i.start, ms) >= 0)
      .map(itemEntry),
    byStart.filter((i) => i.category === "검진" || i.category === "접종").map(itemEntry),
    byStart.filter((i) => i.nature === "지원 신청").map(itemEntry),
    byStart.filter((i) => i.category === "휴가").map(itemEntry),
    t.local.lines.map(localEntry),
  ];

  const sections: ReportSection[] = [];
  const shownAll: Entry[] = [];
  SECTION_HEADINGS.forEach((heading, k) => {
    const list = candidates[k] ?? [];
    const cap = SECTION_CAPS[k] ?? 0;
    const shown = list.slice(0, cap);
    const more = list.length - shown.length;
    shownAll.push(...shown);
    if (shown.length === 0) {
      sections.push({ heading, lines: [FALLBACK_LINE], more: 0, fallback: true });
    } else {
      const lines = shown.map((e) => e.line);
      if (more > 0) lines.push(MORE_LINE(more));
      sections.push({ heading, lines, more, fallback: false });
    }
  });

  const facts = Array.from(new Set(shownAll.flatMap((e) => e.facts)));
  const dates = shownAll.map((e) => e.provenance.as_of);
  const dataAsOf = dates.length > 0 ? dates.reduce((a, b) => (a > b ? a : b)) : "없음";
  const ids = Array.from(new Set(shownAll.flatMap((e) => e.provenance.basis_ids)));
  const docs = resolveBasis(ids);
  const law = docs.filter((d) => d.kind === "law" || d.kind === "admrul" || d.kind === "licbyl").length;
  const web = docs.filter((d) => d.kind === "web").length;

  return {
    asOf,
    monthLabel,
    sections,
    dataAsOf,
    sources: { law, web },
    tools: ["get_timeline"],
    facts,
  };
}

export function renderReport(m: ReportModel, theme: Theme): string {
  const width = 1200;
  const height = 1120;
  const paperX = 440;
  const paperY = 51;
  const paperW = 720;
  const paperH = 1018;
  const X = 476;
  const W = 648;
  const limit = paperY + paperH - 24;

  const reqLabel = textBlock({
    x: 24,
    y: 470,
    text: REQUEST_LABEL,
    maxWidth: 340,
    fontSize: 15,
    bold: true,
    fill: theme.accent,
  });
  const reqBody = textBlock({
    x: 44,
    y: 514,
    text: REPORT_REQUEST,
    maxWidth: 300,
    fontSize: 16,
    lineHeight: 24,
    fill: theme.text,
  });
  const bubbleH = 32 + reqBody.lines * 24;
  const bubble = `<rect x="24" y="484" width="340" height="${bubbleH}" rx="12" fill="${theme.surface}" stroke="${theme.border}"/>`;
  const leftSide = [reqLabel.svg, bubble, reqBody.svg, arrow(372, 484 + bubbleH / 2, 432, theme.muted)].join("\n");

  const paper: string[] = [];
  let y = paperY + 36 + 24;

  const block = (
    gap: number,
    o: { text: string; fontSize: number; fill: string; lineHeight?: number; bold?: boolean },
  ): void => {
    y += gap;
    const b = textBlock({ x: X, y, maxWidth: W, ...o });
    paper.push(b.svg);
    y += b.height;
  };

  const rule = (gap: number): void => {
    y += gap;
    paper.push(`<line x1="${X}" y1="${y}" x2="${X + W}" y2="${y}" stroke="${theme.border}" stroke-width="1"/>`);
  };

  block(0, { text: "한 장 준비 보고서", fontSize: 24, bold: true, fill: theme.text });
  block(10, { text: REPORT_BADGE, fontSize: 14, bold: true, fill: theme.accent });
  rule(14);

  m.sections.forEach((s, k) => {
    block(18, { text: s.heading, fontSize: 16, bold: true, fill: theme.text, lineHeight: 22 });
    s.lines.forEach((line, idx) => {
      const isNote = s.fallback || (s.more > 0 && idx === s.lines.length - 1);
      block(0, { text: `· ${line}`, fontSize: 14, lineHeight: 20, fill: isNote ? theme.muted : theme.text });
    });
    if (k === 3) block(6, { text: WORKER_NOTE, fontSize: 13, fill: theme.muted });
  });

  rule(22);
  const toolLabel = TOOL_LABELS.get_timeline;
  if (!toolLabel) throw new Error("도구 이름 없음: get_timeline");
  block(14, {
    text: `보고서 기준일 ${m.asOf}(이번 달 = ${m.monthLabel}) · 데이터 기준일 ${m.dataAsOf} · 출처: 근거 문서 법령 ${m.sources.law}건 · 기관 안내 ${m.sources.web}건(목록은 일정 응답의 근거 문서에 있음)`,
    fontSize: 13,
    lineHeight: 19,
    fill: theme.muted,
  });
  block(0, { text: REPORT_DISCLAIMER, fontSize: 13, lineHeight: 19, fill: theme.muted });
  block(0, { text: `사용한 기능: ${toolLabel.plain}(키 없이 동작)`, fontSize: 13, lineHeight: 19, fill: theme.muted });

  if (y > limit) throw new Error(`보고서가 종이 높이를 넘칩니다: ${y} > ${limit}`);

  const paperGroup = [
    `<g data-tool="get_timeline">`,
    `<rect x="${paperX}" y="${paperY}" width="${paperW}" height="${paperH}" rx="6" fill="${theme.surface}" stroke="${theme.border}"/>`,
    ...paper,
    `</g>`,
  ].join("\n");

  const desc = `예시 그림. AI 도우미에게 보낸 요청: ${REPORT_REQUEST}. 사용한 기능: get_timeline(키 없이 동작). 보고서 기준일 ${m.asOf}, 데이터 기준일 ${m.dataAsOf}.`;

  return svgDoc({
    width,
    height,
    title: "한 장 준비 보고서 예시",
    desc,
    theme,
    body: [leftSide, paperGroup].join("\n"),
  });
}
