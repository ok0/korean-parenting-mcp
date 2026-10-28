import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));

interface PackEntry {
  files: { path: string }[];
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
      const forbidden = ["scripts/", ".github/", "test/", "build-scripts/", ".docs/", ".ensemble/"];
      for (const p of paths) {
        for (const prefix of forbidden) {
          expect(p.startsWith(prefix), p).toBe(false);
        }
        expect(p, p).not.toContain("fixtures");
        expect(p, p).not.toMatch(/pdfjs|annex|baseline/);
        expect(/^(build|data)\//.test(p) || ["README.md", "LICENSE", "package.json"].includes(p), p).toBe(
          true,
        );
        expect(p.endsWith(".map"), p).toBe(false);
      }
      expect(paths).toContain("build/index.js");
      expect(paths).toContain("data/holidays.json");
      expect(paths).toContain("README.md");
      expect(paths).toContain("LICENSE");
      expect(paths).toContain("package.json");

      const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
        dependencies?: Record<string, string>;
      };
      expect(Object.keys(pkg.dependencies ?? {})).not.toContain("pdfjs-dist");
    },
    60000,
  );
});
