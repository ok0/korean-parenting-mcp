import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  BUILD_INFO_FILE,
  UNKNOWN_COMMIT,
  SEMVER,
  checkMcpbFile,
  checkMcpbRelease,
  makeBuildInfo,
  parseReleaseCheckArgs,
  resolveBuildCommit,
  type McpbReleaseInput,
} from "../scripts/lib/mcpb-release.js";
import { MCPB_ASSET, MCPB_URL } from "../scripts/docs/links.js";
import { OUTPUT_FILE } from "../scripts/lib/mcpb.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (rel: string): string => readFileSync(join(root, rel), "utf8");

type Manifest = {
  version: string;
  user_config: Record<string, { sensitive?: boolean; required?: boolean }>;
};

describe("mcpb release check (M38)", () => {
  let manifestText = "";
  let pkg: { version: string } = { version: "" };
  const sha = "a".repeat(40);
  const other = "b".repeat(40);
  let good: McpbReleaseInput = { manifestJson: "", buildInfoJson: "", expectedCommit: sha };

  const codes = (i: McpbReleaseInput): string[] => checkMcpbRelease(i).map((x) => x.code);
  const mutate = (fn: (m: Manifest) => void): string => {
    const m = JSON.parse(manifestText) as Manifest;
    fn(m);
    return JSON.stringify(m);
  };

  beforeAll(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("fetch disabled in tests");
      }),
    );
    manifestText = read("manifest.json");
    pkg = JSON.parse(read("package.json")) as { version: string };
    good = {
      manifestJson: manifestText,
      buildInfoJson: JSON.stringify(makeBuildInfo(pkg.version, sha, new Date(0))),
      expectedCommit: sha,
    };
  });

  it("real manifest + build info passes", () => {
    expect(checkMcpbRelease(good)).toEqual([]);
    expect((JSON.parse(manifestText) as Manifest).version).toBe(pkg.version);
    expect(SEMVER.test(pkg.version)).toBe(true);
  });

  it("semver violation", () => {
    const badSemver = mutate((m) => {
      m.version = "0.1";
    });
    expect(codes({ ...good, manifestJson: badSemver })).toEqual(["version-not-semver", "version-mismatch"]);

    const prerelease = mutate((m) => {
      m.version = "0.1.0-abc1234+x";
    });
    const buildInfoJson = JSON.stringify(makeBuildInfo("0.1.0-abc1234+x", sha, new Date(0)));
    expect(codes({ manifestJson: prerelease, buildInfoJson, expectedCommit: sha })).toEqual([]);
  });

  it("sensitive missing", () => {
    const manifestJson = mutate((m) => {
      const [first] = Object.keys(m.user_config);
      delete m.user_config[first as string]!.sensitive;
    });
    expect(codes({ ...good, manifestJson })).toEqual(["key-not-sensitive"]);
  });

  it("key set mismatch", () => {
    const missingKey = mutate((m) => {
      delete m.user_config.LAW_OC;
    });
    expect(codes({ ...good, manifestJson: missingKey })).toEqual(["key-set-mismatch"]);

    const extraKey = mutate((m) => {
      m.user_config.FOO_KEY = { sensitive: true, required: false };
    });
    expect(codes({ ...good, manifestJson: extraKey })).toEqual(["key-set-mismatch"]);
  });

  it("commit mismatch", () => {
    expect(codes({ ...good, expectedCommit: other })).toEqual(["commit-mismatch"]);
  });

  it("unreadable inputs", () => {
    expect(codes({ ...good, manifestJson: undefined })).toContain("manifest-unreadable");
    expect(codes({ ...good, buildInfoJson: "{" })).toContain("build-info-unreadable");

    const firstCodes = [
      codes({ ...good, manifestJson: mutate((m) => { m.version = "0.1"; }) })[0],
      codes({
        ...good,
        manifestJson: mutate((m) => {
          const [first] = Object.keys(m.user_config);
          delete m.user_config[first as string]!.sensitive;
        }),
      })[0],
      codes({
        ...good,
        manifestJson: mutate((m) => {
          delete m.user_config.LAW_OC;
        }),
      })[0],
      codes({ ...good, expectedCommit: other })[0],
    ];
    expect(new Set(firstCodes).size).toBe(4);
  });

  it("checkMcpbFile on a missing file", () => {
    const missing = join(tmpdir(), "nope-" + Date.now() + ".mcpb");
    expect(checkMcpbFile(missing, sha).map((x) => x.code)).toEqual(["manifest-unreadable", "build-info-unreadable"]);
  });

  it("resolveBuildCommit", () => {
    expect(resolveBuildCommit({})).toBe(UNKNOWN_COMMIT);
    expect(resolveBuildCommit({ KPM_BUILD_COMMIT: "  " })).toBe(UNKNOWN_COMMIT);
    expect(resolveBuildCommit({ KPM_BUILD_COMMIT: sha })).toBe(sha);
    expect(() => resolveBuildCommit({ KPM_BUILD_COMMIT: "not-a-sha" })).toThrow(/KPM_BUILD_COMMIT/);
  });

  it("makeBuildInfo", () => {
    expect(makeBuildInfo("0.1.0", sha, new Date(0))).toEqual({
      name: "korean-parenting-mcp",
      version: "0.1.0",
      commit: sha,
      built_at: "1970-01-01T00:00:00.000Z",
    });
  });

  it("parseReleaseCheckArgs", () => {
    expect(parseReleaseCheckArgs(["--commit", sha])).toEqual({
      url: MCPB_URL,
      commit: sha,
      attempts: 12,
      intervalMs: 10000,
    });
    expect(() => parseReleaseCheckArgs([])).toThrow();
    expect(() => parseReleaseCheckArgs(["--commit", "x"])).toThrow();
    expect(() => parseReleaseCheckArgs(["--commit", sha, "--attempts", "0"])).toThrow();
    expect(() => parseReleaseCheckArgs(["--commit", sha, "--attempts", "31"])).toThrow();
    expect(() => parseReleaseCheckArgs(["--bogus"])).toThrow();
    expect(OUTPUT_FILE).toBe(MCPB_ASSET);
  });

  it("no auth in the download check", () => {
    const text = read("scripts/mcpb-release-check.ts") + read("scripts/lib/mcpb-release.ts");
    expect(text).not.toMatch(/Authorization|GH_TOKEN|GITHUB_TOKEN|github\.token/);
  });

  it("build-mcpb writes build-info from KPM_BUILD_COMMIT", () => {
    const build = read("scripts/build-mcpb.ts");
    expect(build).toContain("resolveBuildCommit(process.env)");
    expect(build).toContain("BUILD_INFO_FILE");
    expect(build).not.toContain("rev-parse");
    const smoke = read("scripts/mcpb-smoke.ts");
    expect(smoke).toContain("BUILD_INFO_FILE");
    expect(smoke).toContain("checkMcpbRelease(");
  });
});
