import { spawnSync } from "node:child_process";
import { KEY_ENV } from "../../src/core/config.js";
import { MCPB_URL } from "../docs/links.js";

export const BUILD_INFO_FILE = "build-info.json";
export const UNKNOWN_COMMIT = "unknown";
export const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export interface BuildInfo {
  name: string;
  version: string;
  commit: string;
  built_at: string;
}

export function resolveBuildCommit(env: Record<string, string | undefined>): string {
  const v = env.KPM_BUILD_COMMIT?.trim();
  if (!v) return UNKNOWN_COMMIT;
  if (/^[0-9a-f]{40}$/.test(v)) return v;
  throw new Error("KPM_BUILD_COMMIT는 40자리 커밋 SHA여야 합니다");
}

export function makeBuildInfo(version: string, commit: string, now: Date): BuildInfo {
  return { name: "korean-parenting-mcp", version, commit, built_at: now.toISOString() };
}

export type McpbIssueCode =
  | "manifest-unreadable"
  | "version-not-semver"
  | "key-set-mismatch"
  | "key-not-sensitive"
  | "key-required"
  | "build-info-unreadable"
  | "commit-mismatch"
  | "version-mismatch";

export interface McpbIssue {
  code: McpbIssueCode;
  detail: string;
}

export interface McpbReleaseInput {
  manifestJson: string | undefined;
  buildInfoJson: string | undefined;
  expectedCommit: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function checkMcpbRelease(
  input: McpbReleaseInput,
  keyNames: readonly string[] = Object.values(KEY_ENV),
): McpbIssue[] {
  const issues: McpbIssue[] = [];

  let manifest: Record<string, unknown> | undefined;
  try {
    const parsed: unknown = JSON.parse(input.manifestJson ?? "");
    if (isObject(parsed)) manifest = parsed;
  } catch {
    manifest = undefined;
  }
  if (manifest === undefined) {
    issues.push({ code: "manifest-unreadable", detail: "manifest.json" });
  } else {
    const version = manifest.version;
    if (typeof version !== "string" || !SEMVER.test(version)) {
      issues.push({ code: "version-not-semver", detail: String(version) });
    }
    const uc = isObject(manifest.user_config) ? manifest.user_config : {};
    const gotKeys = Object.keys(uc).sort();
    const wantKeys = [...keyNames].sort();
    if (gotKeys.join(",") !== wantKeys.join(",")) {
      issues.push({
        code: "key-set-mismatch",
        detail: `got [${gotKeys.join(", ")}], want [${wantKeys.join(", ")}]`,
      });
    }
    for (const [k, v] of Object.entries(uc)) {
      const entry = isObject(v) ? v : undefined;
      if (entry?.sensitive !== true) issues.push({ code: "key-not-sensitive", detail: k });
      if (entry?.required !== false) issues.push({ code: "key-required", detail: k });
    }
  }

  let buildInfo: Record<string, unknown> | undefined;
  try {
    const parsed: unknown = JSON.parse(input.buildInfoJson ?? "");
    if (isObject(parsed)) buildInfo = parsed;
  } catch {
    buildInfo = undefined;
  }
  if (buildInfo === undefined) {
    issues.push({ code: "build-info-unreadable", detail: BUILD_INFO_FILE });
    return issues;
  }
  if (buildInfo.commit !== input.expectedCommit) {
    issues.push({
      code: "commit-mismatch",
      detail: `got ${String(buildInfo.commit)}, want ${input.expectedCommit}`,
    });
  }
  if (manifest !== undefined && buildInfo.version !== manifest.version) {
    issues.push({
      code: "version-mismatch",
      detail: `build-info ${String(buildInfo.version)}, manifest ${String(manifest.version)}`,
    });
  }
  return issues;
}

export function readMcpbEntry(file: string, entry: string): string | undefined {
  const res = spawnSync("unzip", ["-p", file, entry], { encoding: "utf8" });
  return res.status === 0 ? res.stdout : undefined;
}

export function checkMcpbFile(file: string, expectedCommit: string): McpbIssue[] {
  return checkMcpbRelease({
    manifestJson: readMcpbEntry(file, "manifest.json"),
    buildInfoJson: readMcpbEntry(file, BUILD_INFO_FILE),
    expectedCommit,
  });
}

export interface ReleaseCheckArgs {
  url: string;
  commit: string;
  attempts: number;
  intervalMs: number;
}

const FULL_SHA = /^[0-9a-f]{40}$/;

function intFlag(name: string, raw: string, min: number, max: number): number {
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} 값은 ${min}..${max} 사이의 정수여야 합니다: ${raw}`);
  }
  return n;
}

export function parseReleaseCheckArgs(argv: readonly string[]): ReleaseCheckArgs {
  const out: ReleaseCheckArgs = { url: MCPB_URL, commit: "", attempts: 12, intervalMs: 10000 };
  let hasCommit = false;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag !== "--url" && flag !== "--commit" && flag !== "--attempts" && flag !== "--interval-ms") {
      throw new Error(`알 수 없는 옵션: ${String(flag)}`);
    }
    if (value === undefined) throw new Error(`${flag} 값이 없습니다`);
    i++;
    if (flag === "--url") out.url = value;
    else if (flag === "--commit") {
      if (!FULL_SHA.test(value)) throw new Error("--commit은 40자리 커밋 SHA여야 합니다");
      out.commit = value;
      hasCommit = true;
    } else if (flag === "--attempts") out.attempts = intFlag("--attempts", value, 1, 30);
    else out.intervalMs = intFlag("--interval-ms", value, 0, 60000);
  }
  if (!hasCommit) throw new Error("--commit이 필요합니다");
  return out;
}
