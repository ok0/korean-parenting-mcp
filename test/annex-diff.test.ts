import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { clampLines, diffLines, fenceFor, fenced, formatDiff } from "../scripts/lib/annex-diff.js";

beforeAll(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error("global fetch disabled");
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("annex diff", () => {
  it("identical → no hunks", () => {
    const d = diffLines(["a", "b", "c"], ["a", "b", "c"]);
    expect(d.hunks).toEqual([]);
    expect(d.added).toBe(0);
    expect(d.removed).toBe(0);
    expect(d.approximate).toBe(false);
  });

  it("replace middle line", () => {
    const d = diffLines(["a", "b", "c"], ["a", "x", "c"]);
    expect(formatDiff(d)).toEqual(["@@ -2,1 +2,1 @@", "-b", "+x"]);
    expect(d.added).toBe(1);
    expect(d.removed).toBe(1);
  });

  it("append and prepend", () => {
    const appended = diffLines(["a"], ["a", "b"]);
    expect(formatDiff(appended)).toEqual(["@@ -2,0 +2,1 @@", "+b"]);
    const prepended = diffLines(["z", "a"], ["a"]);
    expect(formatDiff(prepended)).toEqual(["@@ -1,1 +1,0 @@", "-z"]);
  });

  it("large input is approximate and deterministic", () => {
    const oldLines = Array.from({ length: 3000 }, (_, i) => `old ${i}`);
    const newLines = Array.from({ length: 3000 }, (_, i) => `new ${i}`);
    const first = diffLines(oldLines, newLines);
    expect(first.approximate).toBe(true);
    expect(first.added).toBe(3000);
    expect(first.removed).toBe(3000);
    expect(diffLines(oldLines, newLines)).toEqual(first);
  });

  it("clampLines", () => {
    const many = clampLines(Array.from({ length: 100 }, () => "x".repeat(99)), 1000);
    expect(many.shown).toBe(10);
    expect(many.total).toBe(100);
    expect(many.truncated).toBe(true);
    const long = clampLines(["y".repeat(2000)], 10_000);
    expect(long.text.length).toBe(1001);
    expect(long.text.endsWith("…")).toBe(true);
  });

  it("fence outgrows backticks", () => {
    expect(fenceFor("x")).toBe("```");
    expect(fenceFor("a ```` b")).toBe("`````");
    const out = fenced("```\n<img src=x onerror=alert(1)>", "text").split("\n");
    expect(out[0]).toBe("````text");
    expect(out[out.length - 1]).toBe("````");
    for (const line of out.slice(1, -1)) {
      expect(line.startsWith("````")).toBe(false);
    }
  });
});
