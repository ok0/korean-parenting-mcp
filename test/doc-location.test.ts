import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { docsDirViolations, rootDocViolations, type RootEntry } from "./helpers/root-docs.js";

const root = fileURLToPath(new URL("../", import.meta.url));

const CONFIG_FILES = [
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "tsconfig.build.json",
  "tsconfig.scripts.json",
  "manifest.json",
  "server.json",
  "vitest.config.ts",
  ".gitignore",
  ".mcpbignore",
  "Dockerfile",
  ".dockerignore",
];

const isGitRepo = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: root }).status === 0;

function checkIgnored(p: string): number | null {
  return spawnSync("git", ["check-ignore", "-q", p], { cwd: root }).status;
}

const tempRoots: string[] = [];

function tempRoot(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "doc-location-"));
  tempRoots.push(dir);
  for (const [rel, body] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body);
  }
  return dir;
}

describe("document placement (P12)", () => {
  afterEach(() => {
    for (const dir of tempRoots.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

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
      ...["docs", "doc", "src", ".docs"].map((name) => ({ name, isDir: true })),
    ];
    expect(rootDocViolations(entries)).toEqual(["CHANGELOG", "NOTES.md", "doc/", "todo.txt"]);
  });

  it("docs/ in the repository holds only .md files", () => {
    expect(docsDirViolations(root)).toEqual([]);
  });

  it("docsDirViolations passes without docs/ and with only .md", () => {
    expect(docsDirViolations(tempRoot({ "README.md": "# t\n" }))).toEqual([]);
    expect(
      docsDirViolations(
        tempRoot({
          "docs/a.md": "# a\n",
          "docs/clients/b.md": "# b\n",
          "docs/.DS_Store": "",
        }),
      ),
    ).toEqual([]);
  });

  it("docsDirViolations flags non-.md files recursively", () => {
    expect(
      docsDirViolations(
        tempRoot({
          "docs/a.md": "# a\n",
          "docs/img.png": "",
          "docs/clients/x.json": "{}",
        }),
      ),
    ).toEqual(["docs/clients/x.json", "docs/img.png"]);
  });

  it("config and build files are not documents", () => {
    const entries: RootEntry[] = [
      ...CONFIG_FILES.map((name) => ({ name, isDir: false })),
      ...["src", "test", "data", ".github", "deploy"].map((name) => ({ name, isDir: true })),
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

  it("assets/ holds only .svg and .gif files", () => {
    const dir = join(root, "assets");
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === ".DS_Store") continue;
      const ok = e.isFile() && /\.(svg|gif)$/.test(e.name);
      expect(ok, e.name).toBe(true);
    }
  });

  it.skipIf(!isGitRepo)("assets/ is not git-ignored", () => {
    expect(checkIgnored("assets/tool-map-light.svg")).toBe(1);
  });
});
