export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[];
}

export interface DiffResult {
  hunks: DiffHunk[];
  added: number;
  removed: number;
  approximate: boolean;
}

export const LCS_MAX_CELLS = 4_000_000;

const LINE_MAX_CHARS = 1000;

function countMap(lines: readonly string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const line of lines) map.set(line, (map.get(line) ?? 0) + 1);
  return map;
}

function approximateDiff(
  a: readonly string[],
  b: readonly string[],
  pre: number,
): DiffResult {
  const oldBudget = countMap(a);
  const plus = b.filter((line) => {
    const c = oldBudget.get(line) ?? 0;
    if (c > 0) {
      oldBudget.set(line, c - 1);
      return false;
    }
    return true;
  });
  const newBudget = countMap(b);
  const minus = a.filter((line) => {
    const c = newBudget.get(line) ?? 0;
    if (c > 0) {
      newBudget.set(line, c - 1);
      return false;
    }
    return true;
  });
  const lines = [...minus.map((line) => `-${line}`), ...plus.map((line) => `+${line}`)];
  const hunks: DiffHunk[] =
    lines.length === 0
      ? []
      : [{ oldStart: pre + 1, oldCount: minus.length, newStart: pre + 1, newCount: plus.length, lines }];
  return { hunks, added: plus.length, removed: minus.length, approximate: true };
}

export function diffLines(oldLines: readonly string[], newLines: readonly string[]): DiffResult {
  let pre = 0;
  while (pre < oldLines.length && pre < newLines.length && oldLines[pre] === newLines[pre]) pre++;
  let suf = 0;
  while (
    suf < oldLines.length - pre &&
    suf < newLines.length - pre &&
    oldLines[oldLines.length - 1 - suf] === newLines[newLines.length - 1 - suf]
  ) {
    suf++;
  }
  const a = oldLines.slice(pre, oldLines.length - suf);
  const b = newLines.slice(pre, newLines.length - suf);
  const n = a.length;
  const m = b.length;

  if (n * m > LCS_MAX_CELLS) return approximateDiff(a, b, pre);

  const W = m + 1;
  const dp = new Uint32Array((n + 1) * W);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * W + j] =
        a[i] === b[j] ? (dp[(i + 1) * W + j + 1] ?? 0) + 1 : Math.max(dp[(i + 1) * W + j] ?? 0, dp[i * W + j + 1] ?? 0);
    }
  }

  const hunks: DiffHunk[] = [];
  let cur: DiffHunk | undefined;
  let added = 0;
  let removed = 0;
  let i = 0;
  let j = 0;
  const open = (): DiffHunk => {
    cur ??= { oldStart: pre + i + 1, oldCount: 0, newStart: pre + j + 1, newCount: 0, lines: [] };
    return cur;
  };
  const close = (): void => {
    if (cur !== undefined) {
      hunks.push(cur);
      cur = undefined;
    }
  };
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      close();
      i++;
      j++;
    } else if (j >= m || (i < n && (dp[(i + 1) * W + j] ?? 0) >= (dp[i * W + j + 1] ?? 0))) {
      const h = open();
      h.lines.push(`-${a[i] ?? ""}`);
      h.oldCount++;
      removed++;
      i++;
    } else {
      const h = open();
      h.lines.push(`+${b[j] ?? ""}`);
      h.newCount++;
      added++;
      j++;
    }
  }
  close();
  return { hunks, added, removed, approximate: false };
}

export function formatDiff(d: DiffResult): string[] {
  const out: string[] = [];
  for (const h of d.hunks) {
    out.push(
      d.approximate
        ? "@@ 근사 비교(줄 순서 무시) @@"
        : `@@ -${h.oldStart},${h.oldCount} +${h.newStart},${h.newCount} @@`,
    );
    out.push(...h.lines);
  }
  return out;
}

export function clampLines(
  lines: readonly string[],
  maxChars: number,
): { text: string; shown: number; total: number; truncated: boolean } {
  const shownLines: string[] = [];
  let used = 0;
  for (const raw of lines) {
    const line = raw.length > LINE_MAX_CHARS ? `${raw.slice(0, LINE_MAX_CHARS)}…` : raw;
    const cost = line.length + 1;
    if (used + cost > maxChars) break;
    shownLines.push(line);
    used += cost;
  }
  return {
    text: shownLines.join("\n"),
    shown: shownLines.length,
    total: lines.length,
    truncated: shownLines.length < lines.length,
  };
}

export function fenceFor(text: string): string {
  let longest = 0;
  for (const run of text.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  return "`".repeat(Math.max(3, longest + 1));
}

export function fenced(text: string, info: "diff" | "text"): string {
  const f = fenceFor(text);
  return `${f}${info}\n${text}\n${f}`;
}
