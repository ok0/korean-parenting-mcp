/** Korean word for the affiliation term, built at runtime so the source never holds it as one run. */
export const UNOFFICIAL_KO: string = ["비", "공식"].join("");

/** Negative stem: 아니, 아닌, 아님, 아닙. */
export const NEGATIVE_STEM: RegExp = /아니|아닌|아님|아닙/;

/** Patterns that must not appear in checked text. */
export const NEGATIVE_NOTICE_PATTERNS: readonly RegExp[] = [
  new RegExp(UNOFFICIAL_KO),
  /unofficial/i,
  /비제휴/,
  /무관/,
  /관계없는/,
  /개인 프로젝트/,
  NEGATIVE_STEM,
];

/** Assertive claim wording (최신, 받을 수 있, 대상입니다 …) that local-support text must avoid. */
export const LOCAL_ASSERTIVE: RegExp = /최신|받을 수 있|받을 수 없|대상입니다|지급됩니다|제공합니다/u;

/** Patterns that are not checked inside verbatim official text. */
export const VERBATIM_EXEMPT_PATTERNS: readonly RegExp[] = NEGATIVE_NOTICE_PATTERNS.slice(2);

/** One allowlisted exact sentence with its reason and maximum hit count. */
export interface StemAllowEntry {
  text: string;
  reason: string;
  max: number;
}

/** Exact sentences removed before scanning. Currently empty. */
export const NEGATIVE_STEM_ALLOWLIST: readonly StemAllowEntry[] = [];

/** Maximum number of allowlist entries. */
export const NEGATIVE_STEM_ALLOWLIST_CAP = 3;

/** Violations found in one text and allowlist hit counts per entry. */
export interface WordingScan {
  violations: string[];
  allowHits: number[];
}

/** Counts non-overlapping occurrences of needle in haystack. */
export function countOccurrences(haystack: string, needle: string): number {
  if (needle === "") return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return count;
    count += 1;
    from = at + needle.length;
  }
}

/** Removes each non-empty segment from text by replacing it with a newline. */
export function removeSegments(text: string, segments: readonly string[]): string {
  for (const segment of segments) {
    if (segment === "") continue;
    text = text.split(segment).join("\n");
  }
  return text;
}

/** Scans one text for negative or affiliation wording after removing allowlisted sentences and verbatim official text. */
export function scanNegativeWording(
  text: string,
  allowlist: readonly StemAllowEntry[] = NEGATIVE_STEM_ALLOWLIST,
  verbatim: readonly string[] = [],
): WordingScan {
  const violations: string[] = [];
  const allowHits: number[] = allowlist.map(() => 0);
  let rest = text;
  allowlist.forEach((entry, i) => {
    if (entry.text === "") return;
    allowHits[i] = countOccurrences(rest, entry.text);
    rest = rest.split(entry.text).join("\n");
  });
  const verbatimRest = removeSegments(rest, verbatim);
  for (const p of NEGATIVE_NOTICE_PATTERNS) {
    const target = VERBATIM_EXEMPT_PATTERNS.includes(p) ? verbatimRest : rest;
    const m = p.exec(target);
    if (m !== null) {
      violations.push(
        `${p.source} @ "${target.slice(Math.max(0, m.index - 15), m.index + m[0].length + 15)}"`,
      );
    }
  }
  return { violations, allowHits };
}

/** Scans labeled texts and sums allowlist hits across all of them. */
export function checkTexts(
  items: readonly { label: string; text: string; verbatim?: readonly string[] }[],
  allowlist: readonly StemAllowEntry[] = NEGATIVE_STEM_ALLOWLIST,
): { violations: string[]; totals: number[] } {
  const totals: number[] = allowlist.map(() => 0);
  const violations: string[] = [];
  for (const item of items) {
    const r = scanNegativeWording(item.text, allowlist, item.verbatim ?? []);
    r.allowHits.forEach((h, i) => {
      totals[i] = (totals[i] ?? 0) + h;
    });
    for (const v of r.violations) violations.push(`${item.label}: ${v}`);
  }
  return { violations, totals };
}

/** Lists problems with an allowlist given its hit totals. */
export function allowlistProblems(
  entries: readonly StemAllowEntry[],
  totals: readonly number[],
  cap: number = NEGATIVE_STEM_ALLOWLIST_CAP,
): string[] {
  const problems: string[] = [];
  if (entries.length > cap) {
    problems.push(`allowlist size ${entries.length} exceeds cap ${cap}`);
  }
  entries.forEach((e, i) => {
    if (e.text.trim() === "") problems.push(`empty text at ${i}`);
    if (e.reason.trim() === "") problems.push(`empty reason: ${e.text}`);
    if ((totals[i] ?? 0) === 0) problems.push(`unused: ${e.text}`);
    if ((totals[i] ?? 0) > e.max) {
      problems.push(`over max: ${e.text} (${totals[i]} > ${e.max})`);
    }
  });
  return problems;
}

/** Removes tags and decodes common HTML entities. */
export function stripMarkup(s: string): string {
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

/** Collapses runs of whitespace to one space. */
export function collapseWs(s: string): string {
  return s.replace(/\s+/g, " ");
}

/** Removes all whitespace. */
export function noWs(s: string): string {
  return s.replace(/\s+/g, "");
}
