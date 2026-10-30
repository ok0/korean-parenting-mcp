import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ASSET_FILES, PREVIEW_PATH, main } from "../scripts/visuals/generate.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const hasGit = spawnSync("git", ["--version"]).status === 0;

function git(cwd: string, args: string[]): string {
  const r = spawnSync(
    "git",
    ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf8" },
  );
  expect(r.status, r.stderr).toBe(0);
  return r.stdout;
}

function collector(): { io: { stdout(t: string): void; stderr(t: string): void }; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { stdout: (t) => out.push(t), stderr: (t) => err.push(t) }, out, err };
}

describe("visuals refresh rehearsal (M31)", () => {
  it.skipIf(!hasGit)(
    "stale figure: check fails, regenerate fixes it, only assets/*.svg change, works without .docs",
    async () => {
      const tmp = mkdtempSync(join(tmpdir(), "kpm-visuals-"));
      try {
        cpSync(join(root, "assets"), join(tmp, "assets"), { recursive: true });
        writeFileSync(join(tmp, ".gitignore"), ".docs/\n");
        git(tmp, ["init", "-q"]);
        git(tmp, ["add", "-A"]);
        git(tmp, ["commit", "-q", "-m", "base"]);

        const target = ASSET_FILES[0];
        writeFileSync(join(tmp, "assets", target), readFileSync(join(tmp, "assets", target), "utf8") + "<!-- stale -->\n");
        git(tmp, ["commit", "-qam", "stale"]);

        expect(existsSync(join(tmp, ".docs"))).toBe(false);

        const check = collector();
        expect(await main(["--check"], check.io, tmp)).toBe(1);
        expect(check.err.join("")).toContain(target);

        const gen = collector();
        expect(await main([], gen.io, tmp)).toBe(0);
        expect(existsSync(join(tmp, PREVIEW_PATH))).toBe(true);

        const lines = git(tmp, ["status", "--porcelain", "--untracked-files=all"])
          .split("\n")
          .filter((l) => l.length > 0);
        expect(lines).toEqual([` M assets/${target}`]);

        const recheck = collector();
        expect(await main(["--check"], recheck.io, tmp)).toBe(0);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    },
    60000,
  );
});
