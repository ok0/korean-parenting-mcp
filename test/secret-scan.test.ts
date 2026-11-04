import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findLeaks, secretsFromEnv, type LeakRule } from "../scripts/lib/sample-mask.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const secrets = secretsFromEnv(process.env);
const strong = secrets.filter((s) => s.length >= 8);

const HEURISTIC_ALLOW: Record<string, LeakRule[]> = {};

// Official MCP registry schema, vendored byte-identical; its 64-hex value is a documented "example", not a key.
const VENDORED_SCHEMA = {
  rel: "test/fixtures/mcp-registry/server.schema.json",
  sha256: "3fba09590c99f61735d234822279f4223fab9e300c0a81e81c91ab62a4114de0",
  rule: "hex64",
};

const MAX_TRACKED_BYTES = 5 * 1024 * 1024;

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function topDocs(): string[] {
  const dir = join(root, ".docs");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md") && e.name !== "verification-log.md")
    .map((e) => join(dir, e.name));
}

function read(f: string): string {
  return readFileSync(f, "utf8");
}

const targets: { files: string[]; heuristic: boolean; secrets: readonly string[] }[] = [
  { files: walk(join(root, "test/fixtures")), heuristic: true, secrets },
  { files: walk(join(root, ".docs/api-notes")), heuristic: true, secrets },
  { files: walk(join(root, "data")), heuristic: false, secrets },
  {
    files: existsSync(join(root, ".docs/verification-log.md")) ? [join(root, ".docs/verification-log.md")] : [],
    heuristic: false,
    secrets,
  },
  { files: [join(root, "README.md"), join(root, "LICENSE")], heuristic: true, secrets: strong },
  { files: topDocs(), heuristic: true, secrets: strong },
  {
    files: [join(root, "Dockerfile"), join(root, ".dockerignore"), ...walk(join(root, "deploy"))].filter(existsSync),
    heuristic: true,
    secrets: strong,
  },
  {
    files: existsSync(join(root, ".docs/remote/cloud-run.md")) ? [join(root, ".docs/remote/cloud-run.md")] : [],
    heuristic: true,
    secrets: strong,
  },
];

describe("secret scan", () => {
  it("no key-like values in fixtures, notes, data", () => {
    const leaks = targets.flatMap(({ files, heuristic, secrets: list }) =>
      files.flatMap((f) => {
        const rel = relative(root, f);
        const allowed = HEURISTIC_ALLOW[rel] ?? [];
        return findLeaks(read(f), list, { heuristic })
          .filter((r) => !allowed.includes(r))
          .filter(
            (r) =>
              !(
                rel === VENDORED_SCHEMA.rel &&
                r === VENDORED_SCHEMA.rule &&
                createHash("sha256").update(readFileSync(f)).digest("hex") === VENDORED_SCHEMA.sha256
              ),
          )
          .map((r) => `${rel}:${r}`);
      }),
    );
    expect(leaks).toEqual([]);
  });

  it("scan covers recorded fixture folders", () => {
    expect(walk(join(root, "test/fixtures")).length).toBeGreaterThan(0);
  });

  it("scan never touches key folders", () => {
    const scanned = targets.flatMap((t) => t.files);
    for (const p of scanned) {
      expect(p).not.toContain("API정보");
      expect(p).not.toMatch(/\.key(\.txt)?$/);
    }
  });

  it("tracked files contain no configured key values", () => {
    const ls = spawnSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" });
    if (ls.status !== 0) return;
    const paths = ls.stdout.split("\0").filter((p) => p.length > 0);
    const leaks: string[] = [];
    for (const p of paths) {
      const full = join(root, p);
      if (!existsSync(full)) continue;
      if (statSync(full).size > MAX_TRACKED_BYTES) continue;
      const buf = readFileSync(full);
      if (buf.includes(0)) continue;
      for (const r of findLeaks(buf.toString("utf8"), strong)) {
        if (r.startsWith("secret#")) leaks.push(`${p}:${r}`);
      }
    }
    expect(leaks).toEqual([]);
  });
});
