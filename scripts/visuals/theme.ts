export interface Theme {
  name: "light" | "dark";
  bg: string;
  surface: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  builtin: string;
  live: string;
  keyBg: string;
  keyText: string;
  bar: string;
  barDeadline: string;
  bandPregnancy: string;
  bandInfant: string;
  bandChild: string;
}

export const THEMES: { light: Theme; dark: Theme } = {
  light: {
    name: "light",
    bg: "#FFFFFF",
    surface: "#F3F5F8",
    border: "#C9D1DB",
    text: "#1A1F26",
    muted: "#4A5563",
    accent: "#1F5FBF",
    builtin: "#2E6B3A",
    live: "#1F5FBF",
    keyBg: "#FFF1D6",
    keyText: "#7A4B00",
    bar: "#7FA6DD",
    barDeadline: "#D9822B",
    bandPregnancy: "#FCE8EC",
    bandInfant: "#E6F0FB",
    bandChild: "#E8F5EA",
  },
  dark: {
    name: "dark",
    bg: "#0F141A",
    surface: "#1A222C",
    border: "#3A4654",
    text: "#E8EDF2",
    muted: "#A9B4C0",
    accent: "#7DB3FF",
    builtin: "#7FD18E",
    live: "#7DB3FF",
    keyBg: "#3A2A0A",
    keyText: "#FFD27A",
    bar: "#4F7FC0",
    barDeadline: "#E09A4A",
    bandPregnancy: "#3A2028",
    bandInfant: "#1C2C40",
    bandChild: "#1E3324",
  },
};

export function textPairs(t: Theme): ReadonlyArray<readonly [fg: string, bg: string, label: string]> {
  return [
    [t.text, t.bg, "text/bg"],
    [t.text, t.surface, "text/surface"],
    [t.muted, t.bg, "muted/bg"],
    [t.muted, t.surface, "muted/surface"],
    [t.accent, t.bg, "accent/bg"],
    [t.accent, t.surface, "accent/surface"],
    [t.builtin, t.bg, "builtin/bg"],
    [t.builtin, t.surface, "builtin/surface"],
    [t.live, t.bg, "live/bg"],
    [t.live, t.surface, "live/surface"],
    [t.keyText, t.keyBg, "keyText/keyBg"],
    [t.text, t.bandPregnancy, "text/bandPregnancy"],
    [t.text, t.bandInfant, "text/bandInfant"],
    [t.text, t.bandChild, "text/bandChild"],
  ];
}

export const FONT_STACK = "Pretendard, 'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic', sans-serif";

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function fmt(n: number): string {
  return String(Number(n.toFixed(1)));
}

export function estimateWidth(s: string, fontSize: number, bold = false): number {
  let w = 0;
  for (const ch of Array.from(s)) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 0x1100) w += 1.0 * fontSize;
    else if (ch === " ") w += 0.35 * fontSize;
    else w += 0.62 * fontSize;
  }
  return bold ? w * 1.06 : w;
}

export function wrapText(s: string, maxWidth: number, fontSize: number, bold = false): string[] {
  const words = s.split(" ").filter((w) => w.length > 0);
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const ww = estimateWidth(word, fontSize, bold);
    if (ww > maxWidth) throw new Error(`글자 넘침: "${word}" (${ww} > ${maxWidth})`);
    const candidate = cur ? `${cur} ${word}` : word;
    if (estimateWidth(candidate, fontSize, bold) <= maxWidth) {
      cur = candidate;
    } else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

export interface TextBlockOpts {
  x: number;
  y: number;
  text: string | readonly string[];
  maxWidth: number;
  fontSize: number;
  fill: string;
  lineHeight?: number;
  bold?: boolean;
  anchor?: "start" | "middle" | "end";
  maxLines?: number;
}

export function textBlock(o: TextBlockOpts): { svg: string; lines: number; height: number } {
  const bold = o.bold ?? false;
  const lh = o.lineHeight ?? Math.round(o.fontSize * 1.4);
  const lines: string[] = typeof o.text === "string" ? wrapText(o.text, o.maxWidth, o.fontSize, bold) : [...o.text];
  for (const line of lines) {
    const w = estimateWidth(line, o.fontSize, bold);
    if (w > o.maxWidth) throw new Error(`글자 넘침: "${line}" (${w} > ${o.maxWidth})`);
  }
  if (o.maxLines !== undefined && lines.length > o.maxLines) {
    throw new Error(`줄 수 초과: ${lines.length} > ${o.maxLines} ("${lines.join(" ")}")`);
  }
  const attrs = [
    `x="${fmt(o.x)}"`,
    `y="${fmt(o.y)}"`,
    `font-size="${fmt(o.fontSize)}"`,
    `fill="${o.fill}"`,
    `data-max-w="${fmt(o.maxWidth)}"`,
    `letter-spacing="${fmt(-o.fontSize * (o.fontSize >= 18 ? 0.02 : 0.01))}"`,
  ];
  if (bold) attrs.push(`font-weight="700"`);
  if (o.anchor && o.anchor !== "start") attrs.push(`text-anchor="${o.anchor}"`);
  const tspans = lines
    .map((line, i) => `<tspan x="${fmt(o.x)}" y="${fmt(o.y + i * lh)}">${escapeXml(line)}</tspan>`)
    .join("");
  return {
    svg: `<text ${attrs.join(" ")}>${tspans}</text>`,
    lines: lines.length,
    height: lines.length * lh,
  };
}

export function svgDoc(o: { width: number; height: number; title: string; desc: string; theme: Theme; body: string }): string {
  const W = fmt(o.width);
  const H = fmt(o.height);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="title desc" font-family="${FONT_STACK}">\n<title id="title">${escapeXml(o.title)}</title>\n<desc id="desc">${escapeXml(o.desc)}</desc>\n<rect x="0" y="0" width="${W}" height="${H}" fill="${o.theme.bg}"/>\n${o.body}\n</svg>\n`;
}

export function lineCount(text: string, maxWidth: number, fontSize: number, bold = false): number {
  return wrapText(text, maxWidth, fontSize, bold).length;
}

export interface StackItem { lines: number; fontSize: number; lineHeight: number; gapBefore: number }

/** First-line baseline of each item so the whole stack is vertically centred in [top, top+height]. */
export function stackBaselines(top: number, height: number, items: readonly StackItem[]): number[] {
  const total = items.reduce((s, it, i) => s + (i > 0 ? it.gapBefore : 0) + it.lines * it.lineHeight, 0);
  let y = top + (height - total) / 2;
  return items.map((it, i) => {
    if (i > 0) y += it.gapBefore;
    const base = y + (it.lineHeight - it.fontSize) / 2 + it.fontSize * 0.82;
    y += it.lines * it.lineHeight;
    return Math.round(base);
  });
}

export function arrow(x1: number, y: number, x2: number, color: string): string {
  const yy = fmt(y);
  const tip = fmt(x2);
  const base = fmt(x2 - 8);
  return `<line x1="${fmt(x1)}" y1="${yy}" x2="${tip}" y2="${yy}" stroke="${color}" stroke-width="2"/>\n<polygon points="${tip},${yy} ${base},${fmt(y - 5)} ${base},${fmt(y + 5)}" fill="${color}"/>`;
}
