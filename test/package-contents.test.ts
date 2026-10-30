import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));

interface PackEntry {
  files: { path: string }[];
}

const FORBIDDEN_PREFIXES = [
  "scripts/",
  ".github/",
  "test/",
  "build-scripts/",
  "build-mcpb/",
  ".docs/",
  ".ensemble/",
  "assets/",
  "site/",
  "build-site/",
  "docs/",
] as const;

function forbiddenPaths(paths: readonly string[]): string[] {
  return paths.filter((p) => FORBIDDEN_PREFIXES.some((x) => p.startsWith(x)));
}

describe("npm package contents", () => {
  beforeAll(() =>
    vi.stubGlobal("fetch", () => {
      throw new Error("global fetch disabled");
    }),
  );
  afterAll(() => vi.unstubAllGlobals());

  it(
    "npm pack excludes scripts, workflows, tests and fixtures",
    () => {
      const out = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
        cwd: root,
        encoding: "utf8",
      });
      const paths = (JSON.parse(out) as PackEntry[])[0]?.files.map((f) => f.path) ?? [];
      expect(forbiddenPaths(paths)).toEqual([]);
      expect(paths.filter((p) => p.startsWith("docs/"))).toEqual([]);
      for (const p of paths) {
        for (const prefix of FORBIDDEN_PREFIXES) {
          expect(p.startsWith(prefix), p).toBe(false);
        }
        expect(p, p).not.toContain("fixtures");
        expect(p, p).not.toMatch(/pdfjs|annex|baseline/);
        expect(/^(build|data)\//.test(p) || ["README.md", "LICENSE", "package.json"].includes(p), p).toBe(
          true,
        );
        expect(p.endsWith(".map"), p).toBe(false);
        expect(p.endsWith(".mcpb"), p).toBe(false);
        expect(["manifest.json", ".mcpbignore"].includes(p), p).toBe(false);
      }
      expect(paths).toContain("build/index.js");
      expect(paths).toContain("build/setup/setup.js");
      expect(paths).toContain("data/holidays.json");
      expect(paths).toContain("README.md");
      expect(paths).toContain("LICENSE");
      expect(paths).toContain("package.json");

      const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
        dependencies?: Record<string, string>;
      };
      expect(Object.keys(pkg.dependencies ?? {})).not.toContain("pdfjs-dist");

      for (const n of readdirSync(join(root, "data")).filter((n) => n.endsWith(".json"))) {
        expect(paths).toContain("data/" + n);
      }
      expect(paths.filter((p) => /\.(test|spec)\.[cm]?[jt]s$/.test(p))).toEqual([]);
      expect(paths.filter((p) => /\.key(\.txt)?$|(^|\/)\.env/.test(p))).toEqual([]);
      expect(paths.filter((p) => p.startsWith("build/") && p.endsWith(".js")).length).toBeGreaterThan(1);
      expect(paths.filter((p) => p.startsWith("build/remote/"))).toEqual([]);
      expect(paths.filter((p) => /^(Dockerfile|\.dockerignore)$/.test(p) || p.startsWith("deploy/") || /remote-smoke|container-smoke/.test(p))).toEqual([]);
    },
    60000,
  );

  it("forbiddenPaths flags docs/ in a synthetic pack list", () => {
    expect(forbiddenPaths(["README.md", "build/index.js", "docs/install.md", "docs/clients/vscode.md"])).toEqual([
      "docs/install.md",
      "docs/clients/vscode.md",
    ]);
    expect(forbiddenPaths(["README.md", "build/index.js", "data/holidays.json"])).toEqual([]);
  });

  it("mcpb staging never copies docs/", () => {
    const src = readFileSync(join(root, "scripts/build-mcpb.ts"), "utf8");
    expect(src).not.toMatch(/join\(\s*root\s*,\s*["']docs/);
    const copied = [...src.matchAll(/(?:cpSync|copyFileSync)\(\s*join\(\s*root\s*,\s*["']([^"']+)["']/g)].map((m) => m[1]);
    for (const name of copied) {
      expect(["data", ".mcpbignore"]).toContain(name);
    }
  });
});
