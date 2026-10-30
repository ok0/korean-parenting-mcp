export interface MdLink {
  url: string;
  line: number;
}

export interface MdCodeBlock {
  lang: string;
  body: string;
  line: number;
}

export interface MdHeading {
  level: number;
  text: string;
  line: number;
}

interface ScanLine {
  text: string;
  line: number;
  inFence: boolean;
}

interface FenceBlock {
  line: number;
  info: string;
  body: string[];
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const INLINE_LINK = /\]\(\s*<?([^\s)>]+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;
const REF_DEF = /^ {0,3}\[[^\]]+\]:\s*<?([^\s>]+)>?/;
const HREF = /<a\b[^>]*?\bhref\s*=\s*["']([^"']*)["']/gi;
const IMG_SRC = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']*)["']/gi;
const SRCSET = /<source\b[^>]*?\bsrcset\s*=\s*["']([^"']*)["']/gi;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;

function scan(md: string): { lines: ScanLine[]; blocks: FenceBlock[] } {
  const raw = md.split(/\r?\n/);
  if (raw.length > 0 && raw[raw.length - 1] === "") raw.pop();
  const lines: ScanLine[] = [];
  const blocks: FenceBlock[] = [];
  let fence: { ch: string; len: number; block: FenceBlock } | null = null;
  for (let i = 0; i < raw.length; i++) {
    const text = raw[i] ?? "";
    const line = i + 1;
    if (fence) {
      const close = new RegExp(`^ {0,3}${fence.ch}{${fence.len},}[ \\t]*$`);
      if (close.test(text)) {
        lines.push({ text, line, inFence: true });
        fence = null;
      } else {
        fence.block.body.push(text);
        lines.push({ text, line, inFence: true });
      }
      continue;
    }
    const m = FENCE_OPEN.exec(text);
    if (m && !(m[1]?.startsWith("`") && (m[2] ?? "").includes("`"))) {
      const marker = m[1] ?? "```";
      const block: FenceBlock = { line, info: (m[2] ?? "").trim(), body: [] };
      blocks.push(block);
      fence = { ch: marker[0] ?? "`", len: marker.length, block };
      lines.push({ text, line, inFence: true });
      continue;
    }
    lines.push({ text, line, inFence: false });
  }
  return { lines, blocks };
}

export function extractLinks(md: string): MdLink[] {
  const out: MdLink[] = [];
  for (const { text, line, inFence } of scan(md).lines) {
    if (inFence) continue;
    const blank = text.replace(/(`+)(.+?)\1/g, (m) => " ".repeat(m.length));
    const found: { index: number; url: string }[] = [];
    for (const m of blank.matchAll(INLINE_LINK)) {
      found.push({ index: m.index ?? 0, url: m[1] ?? "" });
    }
    const ref = REF_DEF.exec(blank);
    if (ref) found.push({ index: 0, url: ref[1] ?? "" });
    for (const m of blank.matchAll(HREF)) {
      found.push({ index: m.index ?? 0, url: m[1] ?? "" });
    }
    for (const m of blank.matchAll(IMG_SRC)) {
      found.push({ index: m.index ?? 0, url: m[1] ?? "" });
    }
    for (const m of blank.matchAll(SRCSET)) {
      for (const candidate of (m[1] ?? "").split(",")) {
        const url = candidate.trim().split(/\s+/)[0] ?? "";
        if (url) found.push({ index: m.index ?? 0, url });
      }
    }
    found.sort((a, b) => a.index - b.index);
    for (const f of found) out.push({ url: f.url, line });
  }
  return out;
}

export function slugify(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/`/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

/** ATX 제목만 지원한다(Setext 제목 미지원). 프로젝트 문서는 ATX만 쓴다. */
export function headings(md: string): MdHeading[] {
  const out: MdHeading[] = [];
  for (const { text, line, inFence } of scan(md).lines) {
    if (inFence) continue;
    const m = ATX.exec(text);
    if (!m) continue;
    out.push({ level: (m[1] ?? "").length, text: (m[2] ?? "").trim(), line });
  }
  return out;
}

export function headingAnchors(md: string): Set<string> {
  const counts = new Map<string, number>();
  const anchors = new Set<string>();
  for (const h of headings(md)) {
    const base = slugify(h.text);
    const n = counts.get(base);
    if (n === undefined) {
      counts.set(base, 0);
      anchors.add(base);
    } else {
      const next = n + 1;
      counts.set(base, next);
      anchors.add(`${base}-${next}`);
    }
  }
  return anchors;
}

export function codeBlocks(md: string): MdCodeBlock[] {
  return scan(md).blocks.map((b) => ({
    lang: b.info.split(/\s+/)[0] ?? "",
    body: b.body.join("\n"),
    line: b.line,
  }));
}
