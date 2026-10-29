import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findLeaks } from "../../scripts/lib/sample-mask.js";
import { REMOTE_SECRET_ENV, remoteEnvReads } from "../helpers/remote-env-reads.js";

const root = fileURLToPath(new URL("../../", import.meta.url));

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function activeLines(text: string): string {
  return text
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");
}

const hasBash = spawnSync("bash", ["--version"]).status === 0;

describe("Dockerfile", () => {
  const text = read("Dockerfile");

  it("multi-stage, production deps, build only", () => {
    expect(text.match(/^FROM node:22-bookworm-slim/gm)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(text).toContain("npm ci --omit=dev");
    expect(text).toContain("COPY --from=build /app/build ./build");
    expect(text).toContain("COPY data ./data");
    expect(text).not.toMatch(/^COPY \. /m);
    expect(text).not.toMatch(/^COPY \.\/ /m);
  });

  it("starts remote entry as non-root", () => {
    expect(text).toMatch(/^CMD \["node", "build\/remote\/main\.js"\]$/m);
    const users = [...text.matchAll(/^USER\s+(\S+)/gm)].map((m) => m[1]);
    expect(users[users.length - 1]).toBe("node");
    expect(text).toContain("ENV KPM_HTTP_HOST=0.0.0.0");
  });

  it("no VOLUME, vendor directives or secrets", () => {
    expect(text).not.toMatch(/^VOLUME/im);
    expect(text).not.toMatch(/gcloud|google|gcr\.io|pkg\.dev|run\.app|\baws\b|amazon|fly\.io|lightsail|K_SERVICE/i);
    for (const name of [...REMOTE_SECRET_ENV, "KPM_OPERATOR_CONTACT", "KPM_HOST_", "PORT="]) {
      expect(text, name).not.toContain(name);
    }
    expect(findLeaks(text, [], { heuristic: true })).toEqual([]);
  });
});

describe(".dockerignore", () => {
  const lines = new Set(
    read(".dockerignore")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "" && !l.startsWith("#")),
  );

  it.each([".docs", ".ensemble", ".git", "node_modules", "test", "*.key.txt", "**/*.key.txt", ".env*", "deploy"])(
    "excludes %s",
    (entry) => {
      expect(lines.has(entry)).toBe(true);
    },
  );
});

describe("deploy.sh", () => {
  const rel = "deploy/cloud-run/deploy.sh";
  const text = read(rel);
  const active = activeLines(text);

  it.skipIf(!hasBash)("bash syntax", () => {
    const res = spawnSync("bash", ["-n", join(root, rel)]);
    expect(res.status).toBe(0);
  });

  it("executable", () => {
    expect(statSync(join(root, rel)).mode & 0o111).not.toBe(0);
  });

  it("free-tier flags fixed", () => {
    for (const flag of [
      "--max-instances=1",
      "--min-instances=0",
      "--timeout=300",
      "--allow-unauthenticated",
      "--cpu-throttling",
      "--set-secrets",
      "--clear-secrets",
      "asia-northeast3",
      "--source",
    ]) {
      expect(active, flag).toContain(flag);
    }
  });

  it("no paid or floating settings", () => {
    expect(text).not.toMatch(/latest/i);
    expect(active).not.toContain("--no-cpu-throttling");
    expect(active).not.toMatch(/--min-instances[= ]+[1-9]/);
    expect(active).not.toMatch(/--image\b/);
    expect(active).not.toMatch(/--vpc-egress|--network\b|--vpc-connector|--subnet\b/);
  });

  it("confirmation and secret handling", () => {
    for (const s of ["--yes", "--dry-run", "read -r", "[ ! -t 0 ]", "--env-vars-file", "mktemp -d", "trap"]) {
      expect(text, s).toContain(s);
    }
    expect(text).toMatch(/[1-9][0-9]*/);
    for (const name of REMOTE_SECRET_ENV) {
      expect(text, name).toContain(name);
    }
    expect(text).not.toContain(".docs");
    expect(findLeaks(text, [], { heuristic: true })).toEqual([]);
  });

  it("no personal defaults", () => {
    expect(text).not.toMatch(/@(?!example\.com)[\w-]+\.[\w.]+/);
    expect(text).not.toMatch(/CLOUD_RUN_PROJECT:-[^}]/);
  });
});

describe("env.example", () => {
  const rel = "deploy/cloud-run/env.example";
  const text = read(rel);
  const lines = text.split("\n");
  const entries = lines
    .map((line, index) => {
      const m = /^(#\s*)?([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
      return m ? { name: m[2]!, active: m[1] === undefined, value: m[3]!, index } : undefined;
    })
    .filter((e): e is { name: string; active: boolean; value: string; index: number } => e !== undefined);
  const names = entries.map((e) => e.name);

  it("matches actual remote env reads", () => {
    expect([...new Set(names)].sort()).toEqual(remoteEnvReads());
    expect(entries.length).toBe(new Set(names).size);
  });

  it("sanity of recorded reads", () => {
    const reads = remoteEnvReads();
    for (const name of ["PORT", "KPM_HTTP_PORT", "KPM_LOG_LEVEL", "KPM_CHAIN_DEADLINE_MS", "KPM_BUDGET_NEMC_LIST", "KPM_MIN_TTL_SAFETYKOREA_MS", ...REMOTE_SECRET_ENV]) {
      expect(reads, name).toContain(name);
    }
  });

  it("placeholders only", () => {
    for (const e of entries) {
      expect(e.value, e.name).toMatch(/^<[^<>]+>$/);
    }
    for (const name of REMOTE_SECRET_ENV) {
      const e = entries.find((x) => x.name === name);
      expect(e, name).toBeDefined();
      expect(e!.active, name).toBe(false);
      expect(e!.value, name).toBe("<secret-manager>");
    }
    expect(entries.filter((e) => e.active).map((e) => e.name).sort()).toEqual([
      "KPM_ALLOWED_HOSTS",
      "KPM_HOST_COUNTRY",
      "KPM_HOST_LOG_RETENTION",
      "KPM_HOST_PROVIDER",
      "KPM_HOST_REGION",
      "KPM_OPERATOR_CONTACT",
      "KPM_TRUST_PROXY",
    ]);
    for (const m of text.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) ?? []) {
      expect(m.endsWith("example.com"), m).toBe(true);
    }
    expect(findLeaks(text, [], { heuristic: true })).toEqual([]);
  });

  it("each variable has description with trial/prod advice", () => {
    for (const e of entries) {
      const prev = lines[e.index - 1] ?? "";
      expect(prev.startsWith("#"), e.name).toBe(true);
      expect(entries.some((x) => x.index === e.index - 1), e.name).toBe(false);
      expect(prev, e.name).toContain("시험:");
      expect(prev, e.name).toContain("운영:");
    }
  });
});
