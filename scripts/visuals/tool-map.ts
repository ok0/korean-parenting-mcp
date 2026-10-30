import type { ToolDef } from "../../src/tools/registry.js";
import {
  GROUP_ORDER,
  GROUP_TITLES,
  SOURCE_KIND_TEXT,
  TOOL_LABELS,
  assertLabelsCover,
  optionalLive,
  sourceKind,
  type SourceKind,
  type ToolGroup,
} from "./labels.js";
import { arrow, escapeXml, estimateWidth, fmt, lineCount, stackBaselines, svgDoc, textBlock, type Theme } from "./theme.js";

const W = 1200;
const Y0 = 100;
const FLOW_TOP = Y0 + 24;
const R = 8;

function labelOf(name: string): { plain: string; group: ToolGroup } {
  const label = TOOL_LABELS[name];
  if (!label) throw new Error(`도구 라벨 없음: ${name}`);
  return label;
}

function pillWidth(): number {
  return estimateWidth("신청 필요", 11, true) + 16;
}

function lastBaseline(y: number, lines: number, fontSize: number): number {
  return y + (lines - 1) * Math.round(fontSize * 1.4);
}

function card(t: ToolDef, x: number, y: number, theme: Theme): string {
  const kind = sourceKind(t);
  const keyed = kind === "live-key";
  const attrs = `data-tool="${escapeXml(t.name)}" data-source="${kind}"${keyed ? ' data-key="required"' : ""}`;
  const stripe = kind === "builtin" ? theme.builtin : theme.live;
  const parts = [
    `<g ${attrs}>`,
    `<rect x="${fmt(x)}" y="${fmt(y)}" width="236" height="56" rx="8" fill="${theme.surface}" stroke="${theme.border}"/>`,
    `<path d="M${fmt(x + 8)} ${fmt(y)} A8 8 0 0 0 ${fmt(x)} ${fmt(y + 8)} V${fmt(y + 48)} A8 8 0 0 0 ${fmt(x + 8)} ${fmt(y + 56)} Z" fill="${stripe}"/>`,
    textBlock({
      x: x + 16,
      y: keyed ? y + 23 : y + 33,
      text: labelOf(t.name).plain,
      maxWidth: 212,
      fontSize: 14,
      fill: theme.text,
      bold: true,
      maxLines: 1,
    }).svg,
  ];
  if (keyed) {
    const pw = pillWidth();
    parts.push(
      `<rect x="${fmt(x + 16)}" y="${fmt(y + 31)}" width="${fmt(pw)}" height="16" rx="8" fill="${theme.keyBg}"/>`,
      textBlock({
        x: x + 24,
        y: y + 43,
        text: "신청 필요",
        maxWidth: pw - 16,
        fontSize: 11,
        fill: theme.keyText,
        bold: true,
      }).svg,
    );
  }
  parts.push("</g>");
  return parts.join("\n");
}

export function renderToolMap(tools: readonly ToolDef[], theme: Theme): string {
  assertLabelsCover(tools);
  const n = tools.length;
  const body: string[] = [];

  body.push(
    textBlock({
      x: 30,
      y: 44,
      text: `질문 하나가 답이 되기까지 · 도구 ${n}개`,
      maxWidth: 1140,
      fontSize: 22,
      fill: theme.text,
      bold: true,
    }).svg,
    textBlock({
      x: 30,
      y: 70,
      text: "부모가 평소 말로 물으면, AI 도우미가 알맞은 도구를 골라 정보를 찾아 답해요.",
      maxWidth: 1140,
      fontSize: 13,
      fill: theme.muted,
    }).svg,
  );

  const qBody = "“아기 예방접종은 언제 해요?”처럼 평소 말로 물어요";
  const [qHy, qBy] = stackBaselines(FLOW_TOP, 150, [
    { lines: 1, fontSize: 15, lineHeight: 21, gapBefore: 0 },
    { lines: lineCount(qBody, 148, 13), fontSize: 13, lineHeight: 19, gapBefore: 8 },
  ]) as [number, number];
  body.push(
    `<rect x="30" y="${fmt(FLOW_TOP)}" width="180" height="150" rx="${R}" fill="${theme.surface}" stroke="${theme.border}"/>`,
    textBlock({ x: 46, y: qHy, text: "부모의 질문", maxWidth: 148, fontSize: 15, fill: theme.text, bold: true }).svg,
    textBlock({
      x: 46,
      y: qBy,
      text: qBody,
      maxWidth: 148,
      fontSize: 13,
      lineHeight: 19,
      fill: theme.text,
      maxLines: 4,
    }).svg,
    arrow(214, FLOW_TOP + 75, 246, theme.muted),
  );

  const hBody = "질문을 알아듣고 알맞은 도구를 골라 써요";
  const [hHy, hBy] = stackBaselines(FLOW_TOP, 150, [
    { lines: 1, fontSize: 15, lineHeight: 21, gapBefore: 0 },
    { lines: lineCount(hBody, 128, 13), fontSize: 13, lineHeight: 19, gapBefore: 8 },
  ]) as [number, number];
  body.push(
    `<rect x="250" y="${fmt(FLOW_TOP)}" width="160" height="150" rx="${R}" fill="${theme.surface}" stroke="${theme.border}"/>`,
    textBlock({ x: 266, y: hHy, text: "AI 도우미", maxWidth: 128, fontSize: 15, fill: theme.text, bold: true }).svg,
    textBlock({
      x: 266,
      y: hBy,
      text: hBody,
      maxWidth: 128,
      fontSize: 13,
      lineHeight: 19,
      fill: theme.text,
      maxLines: 4,
    }).svg,
    arrow(414, FLOW_TOP + 75, 446, theme.muted),
  );

  let cursor = Y0;
  for (const g of GROUP_ORDER) {
    const inGroup = tools.filter((t) => labelOf(t.name).group === g);
    if (inGroup.length === 0) continue;
    body.push(
      textBlock({
        x: 450,
        y: cursor + 16,
        text: GROUP_TITLES[g],
        maxWidth: 480,
        fontSize: 13,
        fill: theme.muted,
        bold: true,
      }).svg,
    );
    inGroup.forEach((t, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      body.push(card(t, 450 + col * 244, cursor + 24 + row * 64, theme));
    });
    const rows = Math.ceil(inGroup.length / 2);
    cursor += 32 + rows * 64;
  }

  const kinds: SourceKind[] = ["builtin", "live-key"];
  kinds.forEach((kind, idx) => {
    const top = FLOW_TOP + idx * 170;
    const color = kind === "builtin" ? theme.builtin : theme.live;
    const count = tools.filter((t) => sourceKind(t) === kind).length;
    const bodyText =
      kind === "builtin"
        ? "도구 안에 함께 들어 있는 일정표와 안내 자료로 답해요"
        : "물어본 그때 공공기관 자료를 찾아 답해요";
    const [ty, by, cy] = stackBaselines(top + 8, 142, [
      { lines: 1, fontSize: 14, lineHeight: 20, gapBefore: 0 },
      { lines: lineCount(bodyText, 168, 13), fontSize: 13, lineHeight: 19, gapBefore: 8 },
      { lines: 1, fontSize: 13, lineHeight: 19, gapBefore: 12 },
    ]) as [number, number, number];
    body.push(
      `<rect x="970" y="${fmt(top)}" width="200" height="150" rx="${R}" fill="${theme.surface}" stroke="${theme.border}"/>`,
      `<path d="M970 ${fmt(top + 8)} A8 8 0 0 1 978 ${fmt(top)} H1162 A8 8 0 0 1 1170 ${fmt(top + 8)} Z" fill="${color}"/>`,
      textBlock({
        x: 986,
        y: ty,
        text: SOURCE_KIND_TEXT[kind],
        maxWidth: 168,
        fontSize: 14,
        fill: color,
        bold: true,
        maxLines: 1,
      }).svg,
      textBlock({
        x: 986,
        y: by,
        text: bodyText,
        maxWidth: 168,
        fontSize: 13,
        lineHeight: 19,
        fill: theme.text,
        maxLines: 4,
      }).svg,
      textBlock({
        x: 986,
        y: cy,
        text: `도구 ${count}개`,
        maxWidth: 168,
        fontSize: 13,
        fill: theme.text,
        bold: true,
      }).svg,
      arrow(934, top + 75, 966, theme.muted),
    );
  });

  const flowBottom = Math.max(FLOW_TOP + 320, cursor - 16);
  const Ly = flowBottom + 40;
  const t1 = "미리 담아 둔 정보로 답해요";
  const t2 = "공공기관에서 바로 확인해요";
  const w1 = Math.ceil(estimateWidth(t1, 13));
  const w2 = Math.ceil(estimateWidth(t2, 13));
  const x2 = 52 + w1 + 32;
  const pw = pillWidth();
  const px = x2 + 22 + w2 + 32;
  const descX = px + pw + 8;
  body.push(
    `<rect x="30" y="${fmt(Ly - 12)}" width="14" height="14" fill="${theme.builtin}"/>`,
    textBlock({ x: 52, y: Ly, text: t1, maxWidth: w1, fontSize: 13, fill: theme.text }).svg,
    `<rect x="${fmt(x2)}" y="${fmt(Ly - 12)}" width="14" height="14" fill="${theme.live}"/>`,
    textBlock({ x: x2 + 22, y: Ly, text: t2, maxWidth: w2, fontSize: 13, fill: theme.text }).svg,
    `<rect x="${fmt(px)}" y="${fmt(Ly - 12)}" width="${fmt(pw)}" height="16" rx="8" fill="${theme.keyBg}"/>`,
    textBlock({ x: px + 8, y: Ly, text: "신청 필요", maxWidth: pw - 16, fontSize: 11, fill: theme.keyText, bold: true }).svg,
    textBlock({
      x: descX,
      y: Ly,
      text: "공공기관에 따로 사용 신청을 해야 쓸 수 있어요",
      maxWidth: 1170 - descX,
      fontSize: 13,
      fill: theme.text,
    }).svg,
  );

  let footerY = Ly + 32;
  const optionalLabels = tools.filter(optionalLive).map((t) => labelOf(t.name).plain);
  if (optionalLabels.length > 0) {
    const y = Ly + 32;
    const note = textBlock({
      x: 30,
      y,
      text: `※ ${optionalLabels.join(", ")} 도구는 미리 담아 둔 정보로 계산하고, 따로 신청해 두면 공휴일과 법령 변경 여부도 공공기관에서 확인해요.`,
      maxWidth: 1140,
      fontSize: 12,
      fill: theme.muted,
    });
    body.push(note.svg);
    footerY = lastBaseline(y, note.lines, 12) + 21;
  }

  const footer = textBlock({
    x: 30,
    y: footerY,
    text: "비공식 도구예요. 공공기관 자료를 쓰지만 공공기관이 만든 서비스는 아니에요.",
    maxWidth: 1140,
    fontSize: 12,
    fill: theme.muted,
  });
  body.push(footer.svg);
  const H = lastBaseline(footerY, footer.lines, 12) + 28;

  return svgDoc({
    width: W,
    height: H,
    title: `육아 도우미 한 장 지도 (도구 ${n}개)`,
    desc: `부모의 질문을 AI 도우미가 받아 도구 ${n}개 중 알맞은 것을 고르고, 도구는 미리 담아 둔 정보나 공공기관 자료로 답합니다. 도구: ${tools.map((t) => t.name).join(", ")}`,
    theme,
    body: body.join("\n"),
  });
}
