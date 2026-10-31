import { proseLines } from "./docs-checklist.js";

/** PAC38 / ADR-57: order is fixed; tests pair one synthetic sample per index. */
export const REMOTE_PROMISE_PATTERNS: readonly RegExp[] = [
  /run\.app/i,
  /fly\.dev|onrender\.com|workers\.dev|vercel\.app|koyeb\.app/i,
  /원격/,
  /\bremote\b/i,
  /곧 제공/,
  /제공한 뒤|제공 후|제공할 예정|안내할 예정/,
  /\bM26\b/,
  /remote\.md/,
  /커넥터 (URL|주소)/,
  /\/privacy\b/,
];

export const CHATGPT_UNSUPPORTED_LINE = "ChatGPT는 내 컴퓨터에서 실행하는 이 서버를 직접 추가할 수 없어서 현재 지원하지 않아요.";

export const CHATGPT_ALLOWED = /지원하지 않|미지원/;

/** Announcement words forbidden on a ChatGPT line (only checked on lines containing "ChatGPT"; "예정" alone is common elsewhere, e.g. 출산예정일). */
export const CHATGPT_PROMISE = /예정|추후|나중에|준비 중|곧/;

export type TextKind = "markdown" | "plain";

const PUBLIC_PACKAGE_KEYS = ["name", "description", "keywords", "homepage", "bin", "repository"] as const;

export function remotePromiseProblems(file: string, text: string, kind: TextKind): string[] {
  const out: string[] = [];
  const rawLines = text.split(/\r?\n/);
  rawLines.forEach((line, i) => {
    for (const p of REMOTE_PROMISE_PATTERNS) {
      if (p.test(line)) out.push(`${file}:${i + 1}행: ${p.source}`);
    }
  });
  const chatgptLines = kind === "markdown" ? proseLines(text) : rawLines.map((line, i) => ({ line: i + 1, text: line }));
  for (const { line, text: lineText } of chatgptLines) {
    if (!lineText.includes("ChatGPT")) continue;
    if (!CHATGPT_ALLOWED.test(lineText)) out.push(`${file}:${line}행: ChatGPT 미지원 문구 없음`);
    if (CHATGPT_PROMISE.test(lineText)) out.push(`${file}:${line}행: ChatGPT 예고 표현`);
  }
  return out;
}

export function publicPackageText(pkg: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const k of PUBLIC_PACKAGE_KEYS) {
    const v = pkg[k];
    if (v === undefined) continue;
    lines.push(`${k}: ${JSON.stringify(v)}`);
  }
  return lines.join("\n");
}
