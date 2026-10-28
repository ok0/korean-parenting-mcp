import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("stdio guard", () => {
  it("console methods write to stderr, not stdout", () => {
    const url = pathToFileURL(resolve("build/stdio-guard.js")).href;
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `await import(${JSON.stringify(url)}); console.log("LOG_MARK"); console.info("INFO_MARK"); console.debug("DEBUG_MARK"); console.warn("WARN_MARK");`,
      ],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("LOG_MARK");
    expect(result.stderr).toContain("INFO_MARK");
    expect(result.stderr).toContain("DEBUG_MARK");
    expect(result.stderr).toContain("WARN_MARK");
  });

  it("entry imports stdio-guard first", () => {
    const source = readFileSync(resolve("src/index.ts"), "utf8");
    const firstImport = source.match(/^import\s.+$/m)?.[0];
    expect(firstImport).toBe('import "./stdio-guard.js";');
  });
});
