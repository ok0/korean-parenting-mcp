import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { rootDocViolations, type RootEntry } from "./helpers/root-docs.js";

const root = fileURLToPath(new URL("../", import.meta.url));

const CONFIG_FILES = [
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "tsconfig.build.json",
  "tsconfig.scripts.json",
  "manifest.json",
  "vitest.config.ts",
  ".gitignore",
  ".mcpbignore",
];

const isGitRepo = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: root }).status === 0;

function checkIgnored(p: string): number | null {
  return spawnSync("git", ["check-ignore", "-q", p], { cwd: root }).status;
}

describe("document placement (P12)", () => {
  it("root documents are only README.md and LICENSE", () => {
    const entries: RootEntry[] = readdirSync(root, { withFileTypes: true }).map((e) => ({
      name: e.name,
      isDir: e.isDirectory(),
    }));
    expect(rootDocViolations(entries)).toEqual([]);
    expect(existsSync(join(root, "README.md"))).toBe(true);
    expect(existsSync(join(root, "LICENSE"))).toBe(true);
  });

  it("flags extra documents in a mocked root", () => {
    const entries: RootEntry[] = [
      ...["README.md", "LICENSE", ...CONFIG_FILES, "NOTES.md", "CHANGELOG", "todo.txt"].map((name) => ({
        name,
        isDir: false,
      })),
      ...["docs", "src", ".docs"].map((name) => ({ name, isDir: true })),
    ];
    expect(rootDocViolations(entries)).toEqual(["CHANGELOG", "NOTES.md", "docs/", "todo.txt"]);
  });

  it("config and build files are not documents", () => {
    const entries: RootEntry[] = [
      ...CONFIG_FILES.map((name) => ({ name, isDir: false })),
      ...["src", "test", "data", ".github"].map((name) => ({ name, isDir: true })),
    ];
    expect(rootDocViolations(entries)).toEqual([]);
  });

  it.skipIf(!isGitRepo)(".docs and .ensemble are git-ignored", () => {
    for (const p of [".docs/", ".ensemble/", ".docs/release-checklist.md", ".ensemble/blueprint.md"]) {
      expect(checkIgnored(p), p).toBe(0);
    }
    for (const p of ["README.md", "LICENSE"]) {
      expect(checkIgnored(p), p).toBe(1);
    }
  });
});
