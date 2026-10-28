import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findLeaks, secretsFromEnv, type LeakRule } from "../scripts/lib/sample-mask.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const secrets = secretsFromEnv(process.env);

const HEURISTIC_ALLOW: Record<string, LeakRule[]> = {};

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function read(f: string): string {
  return readFileSync(f, "utf8");
}

const targets = [
  { files: walk(join(root, "test/fixtures")), heuristic: true },
  { files: walk(join(root, ".docs/api-notes")), heuristic: true },
  { files: walk(join(root, "data")), heuristic: false },
];

describe("secret scan", () => {
  it("no key-like values in fixtures, notes, data", () => {
    const leaks = targets.flatMap(({ files, heuristic }) =>
      files.flatMap((f) => {
        const rel = relative(root, f);
        const allowed = HEURISTIC_ALLOW[rel] ?? [];
        return findLeaks(read(f), secrets, { heuristic })
          .filter((r) => !allowed.includes(r))
          .map((r) => `${rel}:${r}`);
      }),
    );
    expect(leaks).toEqual([]);
  });

  it("scan covers recorded fixture folders", () => {
    expect(walk(join(root, "test/fixtures")).length).toBeGreaterThan(0);
  });
});
