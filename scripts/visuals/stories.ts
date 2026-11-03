import { SOURCE_NOTICE } from "../../src/core/notice.js";
import { formatDate } from "../../src/date/civil-date.js";
import type { OfflineTimeline } from "../../src/timeline/offline.js";
import type { ToolDef } from "../../src/tools/registry.js";
import { SOURCE_KIND_TEXT, TOOL_LABELS, sourceKind, type SourceKind } from "./labels.js";
import { arrow, estimateWidth, fmt, svgDoc, textBlock, type Theme } from "./theme.js";

export interface StorySpec {
  tool: string;
  sourceName: string | null;
  question(t: OfflineTimeline): string;
  answer(t: OfflineTimeline): string;
}

function itemEnd(t: OfflineTimeline, id: string): string {
  const item = t.result.items.find((i) => i.id === id);
  if (item === undefined) throw new Error(`항목 없음: ${id}`);
  if (item.end === undefined) throw new Error(`종료일 없음: ${id}`);
  return formatDate(item.end);
}

export const STORY_SPECS: readonly StorySpec[] = [
  {
    tool: "find_night_pediatric",
    sourceName: "국립중앙의료원",
    question: () => "새벽에 아이가 열이 나요. 지금 문 연 소아 진료가 있을까요?",
    answer: () =>
      "예시: 지금 진료 중으로 나온 곳의 후보와 전화번호를 보여 줘요. 가기 전에 전화로 꼭 확인하고, 위급하면 119에 연락하세요.",
  },
  {
    tool: "get_timeline",
    sourceName: null,
    question: (t) => `출산예정일이 ${formatDate(t.view.birthDate)}예요. 언제까지 뭘 해야 하나요?`,
    answer: (t) =>
      `예시: 출생신고는 ${itemEnd(t, "birth-registration")}까지, 부모급여 신청은 ${itemEnd(t, "parent-allowance")}까지예요. 검진과 접종 일정도 날짜순으로 정리해 줘요.`,
  },
  {
    tool: "check_recall",
    sourceName: "제품안전정보센터",
    question: () => "중고로 받은 아기 카시트, 리콜된 적 있나요?",
    answer: () =>
      "예시: 같은 이름으로 공개된 리콜 기록이 있으면 날짜와 사유를 보여 줘요. 기록이 없다고 안전하다는 뜻은 아니에요.",
  },
];

export interface Story {
  tool: string;
  toolLabel: string;
  kind: SourceKind;
  sourceName: string | null;
  sourceLabel: string;
  question: string;
  answer: string;
  exampleTag: "예시";
}

export function buildStories(tools: readonly ToolDef[], t: OfflineTimeline): Story[] {
  return STORY_SPECS.map((spec) => {
    const tool = tools.find((x) => x.name === spec.tool);
    if (tool === undefined) throw new Error(`도구 없음: ${spec.tool}`);
    const label = TOOL_LABELS[spec.tool];
    if (label === undefined) throw new Error(`라벨 없음: ${spec.tool}`);
    const kind = sourceKind(tool);
    if (spec.sourceName === null && kind !== "builtin") {
      throw new Error(`출처 불일치: ${spec.tool} (출처 없음인데 ${kind})`);
    }
    if (spec.sourceName !== null && kind !== "live-key") {
      throw new Error(`출처 불일치: ${spec.tool} (출처 ${spec.sourceName}인데 ${kind})`);
    }
    if (spec.sourceName !== null && !tool.title.includes(spec.sourceName)) {
      throw new Error(`출처가 도구 제목에 없음: ${spec.tool} (${spec.sourceName})`);
    }
    const answer = spec.answer(t);
    if (!answer.startsWith("예시")) throw new Error(`답이 예시로 시작하지 않음: ${spec.tool}`);
    return {
      tool: spec.tool,
      toolLabel: label.plain,
      kind,
      sourceName: spec.sourceName,
      sourceLabel: SOURCE_KIND_TEXT[kind] + (spec.sourceName ? ` · ${spec.sourceName}` : ""),
      question: spec.question(t),
      answer,
      exampleTag: "예시",
    };
  });
}

const W = 1200;
const COLX = [100, 374, 648, 922] as const;
const CARD_W = 248;
const PAD = 16;
const TEXT_W = CARD_W - 2 * PAD;
const TEXT_FS = 14;
const LH = 20;
const TEXT_TOP = 30;

function colAt(c: number): number {
  const x = COLX[c];
  if (x === undefined) throw new Error(`열 없음: ${c}`);
  return x;
}

export function renderStories(tools: readonly ToolDef[], t: OfflineTimeline, theme: Theme): string {
  const stories = buildStories(tools, t);
  const parts: string[] = [];
  parts.push(
    textBlock({
      x: 30,
      y: 44,
      text: "이렇게 물으면 이렇게 찾아요 · 예시 3가지",
      maxWidth: 1140,
      fontSize: 22,
      bold: true,
      fill: theme.text,
    }).svg,
  );
  parts.push(
    textBlock({
      x: 30,
      y: 70,
      text: "질문 예시가 도구와 출처를 거쳐 답이 되는 길을 따라가 봐요. 답은 모두 예시예요.",
      maxWidth: 1140,
      fontSize: 13,
      fill: theme.muted,
    }).svg,
  );
  ["질문", "도구", "출처", "답 (예시)"].forEach((h, c) => {
    parts.push(
      textBlock({ x: colAt(c) + PAD, y: 104, text: h, maxWidth: TEXT_W, fontSize: 13, bold: true, fill: theme.muted }).svg,
    );
  });

  let rowY = 120;
  stories.forEach((s, i) => {
    const keyed = s.kind === "live-key";
    const kindFill = s.kind === "builtin" ? theme.builtin : theme.live;
    const bodies = [
      { text: s.question, bold: false, fill: theme.text },
      { text: s.toolLabel, bold: true, fill: theme.text },
      { text: s.sourceLabel, bold: true, fill: kindFill },
      { text: s.answer, bold: false, fill: theme.text },
    ];
    const blocks = bodies.map((b, c) =>
      textBlock({
        x: colAt(c) + PAD,
        y: rowY + TEXT_TOP,
        text: b.text,
        maxWidth: TEXT_W,
        fontSize: TEXT_FS,
        lineHeight: LH,
        bold: b.bold,
        fill: b.fill,
      }),
    );
    const toolBlock = blocks[1];
    if (toolBlock === undefined) throw new Error("도구 칸 없음");
    const contentHeights = blocks.map((b, c) => b.height + (c === 1 && keyed ? 22 : 0));
    const cardH = Math.max(64, ...contentHeights.map((h) => h + 2 * PAD));

    const pillTextW = estimateWidth("신청 필요", 11, true);
    const pillW = pillTextW + 16;
    const pillX = colAt(1) + PAD;
    const pillY = rowY + PAD + toolBlock.height + 6;

    const rects = COLX.map(
      (x) =>
        `<rect x="${fmt(x)}" y="${fmt(rowY)}" width="${CARD_W}" height="${fmt(cardH)}" rx="8" fill="${theme.surface}" stroke="${theme.border}"/>`,
    );
    const pill = keyed
      ? [
          `<rect x="${fmt(pillX)}" y="${fmt(pillY)}" width="${fmt(pillW)}" height="16" rx="8" fill="${theme.keyBg}"/>`,
          textBlock({
            x: pillX + 8,
            y: pillY + 12,
            text: "신청 필요",
            maxWidth: pillW - 16,
            fontSize: 11,
            bold: true,
            fill: theme.keyText,
          }).svg,
        ]
      : [];
    const arrows = COLX.slice(0, -1).map((x, c) =>
      arrow(x + CARD_W + 4, rowY + cardH / 2, colAt(c + 1) - 4, theme.muted),
    );

    parts.push(
      [
        `<g data-story="${i + 1}" data-tool="${s.tool}" data-source="${s.kind}"${keyed ? ' data-key="required"' : ""}>`,
        textBlock({
          x: 30,
          y: rowY + TEXT_TOP,
          text: `예시 ${i + 1}`,
          maxWidth: 60,
          fontSize: 13,
          bold: true,
          fill: theme.accent,
        }).svg,
        ...rects,
        ...blocks.map((b) => b.svg),
        ...pill,
        ...arrows,
        "</g>",
      ].join("\n"),
    );
    rowY += cardH + 20;
  });

  const footer = textBlock({
    x: 30,
    y: rowY + 16,
    text: `모두 예시예요. 실제 답은 그때 공개된 정보에 따라 달라지고, 건강 문제는 의료진과 상의하세요. ${SOURCE_NOTICE}`,
    maxWidth: 1140,
    fontSize: 12,
    fill: theme.muted,
  });
  parts.push(footer.svg);

  return svgDoc({
    width: W,
    height: rowY + 44 + (footer.lines - 1) * 17,
    title: "질문 따라가기 예시 3가지",
    desc: `예시 질문 3개가 도구와 출처를 거쳐 답이 되는 과정입니다. 도구: ${stories.map((s) => s.tool).join(", ")}`,
    theme,
    body: parts.join("\n"),
  });
}
