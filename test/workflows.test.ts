import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));

const WORKFLOWS = [
  ".github/workflows/ci.yml",
  ".github/workflows/revision-check.yml",
  ".github/workflows/holidays-refresh.yml",
  ".github/workflows/visuals-refresh.yml",
] as const;

const USES =
  /^(actions\/[a-z-]+(\/[a-z-]+)?@v\d+\.\d+\.\d+|docker:\/\/rhysd\/actionlint:\d+\.\d+\.\d+|[\w.-]+\/[\w.-]+@[0-9a-f]{40})$/;

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function steps(text: string): string[] {
  return text.split(/^ {6}- /m);
}

function block(text: string, needle: string): string {
  return steps(text).find((s) => s.includes(needle)) ?? "";
}

function blockIndex(text: string, needle: string): number {
  return steps(text).findIndex((s) => s.includes(needle));
}

function secretNames(text: string): string[] {
  return [...text.matchAll(/\$\{\{\s*secrets\.([A-Za-z_]+)\s*\}\}/g)].map((m) => m[1] ?? "");
}

function topPermissions(text: string): Record<string, string> {
  const lines = text.split("\n");
  const idx = lines.indexOf("permissions:");
  const out: Record<string, string> = {};
  if (idx < 0) return out;
  for (const line of lines.slice(idx + 1)) {
    const m = /^ {2}([\w-]+): (\S+)\s*$/.exec(line);
    if (!m) break;
    out[m[1] ?? ""] = m[2] ?? "";
  }
  return out;
}

function stepIndex(text: string, re: RegExp): number {
  return steps(text).findIndex((s) => re.test(s));
}

const hasActionlint = spawnSync("actionlint", ["-version"]).status === 0;

describe("workflows", () => {
  beforeAll(() =>
    vi.stubGlobal("fetch", () => {
      throw new Error("global fetch disabled");
    }),
  );
  afterAll(() => vi.unstubAllGlobals());

  it("all workflows: secrets only via env, never echoed, pinned actions", () => {
    for (const file of WORKFLOWS) {
      const text = read(file);
      for (const line of text.split("\n")) {
        if (line.includes("secrets.")) {
          expect(line, file).toMatch(/^\s+[A-Z_]+: \$\{\{ secrets\.[A-Z_]+ \}\}\s*$/);
        }
        if (/echo/.test(line)) {
          expect(line, file).not.toMatch(/secrets|LAW_OC|DATA_GO_KR_SERVICE_KEY/);
        }
      }
      expect(text, file).not.toMatch(/\$\{?(LAW_OC|DATA_GO_KR_SERVICE_KEY)\b/);
      expect(text, file).not.toContain("set -x");
      expect(text, file).not.toContain("ACTIONS_STEP_DEBUG");
      for (const m of text.matchAll(/uses:\s*(\S+)/g)) {
        expect(m[1] ?? "", file).toMatch(USES);
      }
      expect(text.match(/^[ \t]*permissions:/gm)?.length ?? 0, file).toBe(1);
    }
  });

  it("ci.yml", () => {
    const text = read(".github/workflows/ci.yml");
    expect(text).toMatch(/^\s+push:/m);
    expect(text).toMatch(/^\s+pull_request:/m);
    expect(text).toContain("npm ci");
    expect(text).toContain("npm run verify");
    expect(text).toContain("npm run smoke:pack");
    expect(text).toContain("npm run smoke:mcpb");
    expect(text).toMatch(/node:\s*\[\s*"20",\s*"22"\s*\]/);
    expect(text).toContain("${{ matrix.node }}");
    expect(text).toContain("rhysd/actionlint");
    expect(secretNames(text)).toEqual([]);
    expect(topPermissions(text)).toEqual({ contents: "read" });
  });

  it("revision-check.yml", () => {
    const text = read(".github/workflows/revision-check.yml");
    expect(text).toMatch(/cron:\s*"\d{1,2} \d{1,2} \* \* [0-6]"/);
    expect(text).toContain("workflow_dispatch:");
    expect(secretNames(text)).toEqual(["LAW_OC"]);
    expect(topPermissions(text)).toEqual({ contents: "read", issues: "write" });

    const issue = block(text, "gh issue create");
    expect(issue).toContain("if: steps.check.outputs.code == '10'");
    expect(issue).toContain("gh issue list");
    expect(issue).toContain("gh issue comment");

    const check = block(text, "check-revisions.js");
    expect(check).toContain("-ne 10");
    expect(check).toContain('exit "$code"');
    expect(check).not.toContain("gh issue");
    expect(check).toContain('--baseline-dir "$RUNNER_TEMP/annex-baseline"');

    const restore = block(text, "actions/cache/restore@");
    const save = block(text, "actions/cache/save@");
    expect(restore).toContain("${{ runner.temp }}/annex-baseline");
    expect(save).toContain("${{ runner.temp }}/annex-baseline");
    expect(save).toContain("steps.check.outputs.code == '10'");
    expect(restore).not.toContain("secrets.");

    const restoreIdx = blockIndex(text, "actions/cache/restore@");
    const checkIdx = blockIndex(text, "check-revisions.js");
    const saveIdx = blockIndex(text, "actions/cache/save@");
    expect(restoreIdx).toBeGreaterThanOrEqual(0);
    expect(restoreIdx < checkIdx && checkIdx < saveIdx).toBe(true);

    expect(text).toContain("timeout-minutes:");
    expect(existsSync(join(root, "scripts/check-revisions.ts"))).toBe(true);
  });

  it("holidays-refresh.yml", () => {
    const text = read(".github/workflows/holidays-refresh.yml");
    expect(text).toMatch(/cron:\s*"\d{1,2} \d{1,2} \d{1,2} \* \*"/);
    expect(text).toContain("workflow_dispatch:");
    expect(secretNames(text)).toEqual(["DATA_GO_KR_SERVICE_KEY"]);
    expect(topPermissions(text)).toEqual({ contents: "write", "pull-requests": "write" });

    const pr = block(text, "gh pr create");
    expect(pr).toContain("if: steps.refresh.outputs.code == '10'");
    expect(text).toContain("automation/holidays-refresh");
    expect(text).not.toMatch(/gh pr merge|--auto\b|auto-merge|automerge/i);
    expect(existsSync(join(root, "scripts/refresh-holidays.ts"))).toBe(true);
  });

  it("visuals-refresh.yml", () => {
    const text = read(".github/workflows/visuals-refresh.yml");
    expect(text).toMatch(/^  push:\n    branches: \[main\]\n    paths: \["data\/\*\*", "src\/\*\*", "scripts\/visuals\/\*\*"\]$/m);
    expect(text).toMatch(/^  workflow_dispatch:$/m);
    expect(text).not.toMatch(/^\s+(schedule|pull_request|pull_request_target):/m);

    expect(secretNames(text)).toEqual([]);
    expect(text).not.toContain("secrets.");
    expect(topPermissions(text)).toEqual({ contents: "write", "pull-requests": "write" });

    expect(text).toMatch(/^concurrency:\n  group: visuals-refresh\n  cancel-in-progress: false$/m);
    expect(text).toContain("BRANCH: automation/visuals-refresh");
    expect(text).toContain('node-version: "22"');

    const ci = stepIndex(text, /^run: npm ci$/m);
    const gen = stepIndex(text, /^\s*run: npm run visuals$/m);
    const diff = stepIndex(text, /git status --porcelain -- 'assets\/\*\.svg'/);
    const pr = stepIndex(text, /gh pr create/);
    expect(ci >= 0 && ci < gen && gen < diff && diff < pr).toBe(true);

    const diffStep = steps(text)[diff] ?? "";
    expect(diffStep).toContain("id: diff");
    expect(diffStep).toContain('echo "changed=true" >> "$GITHUB_OUTPUT"');

    const prStep = steps(text)[pr] ?? "";
    expect(prStep).toContain("if: steps.diff.outputs.changed == 'true'");
    expect(prStep).toContain("GH_TOKEN: ${{ github.token }}");
    expect(prStep).toContain("gh pr list");
    expect(prStep).toContain("gh pr edit");
    expect(prStep).toContain("npm run visuals:check");
    expect(prStep).toContain("자동 생성 PR");

    expect([...text.matchAll(/git add[^\n]*/g)].map((m) => m[0])).toEqual([
      "git add -- 'assets/*.svg'",
    ]);
    expect(text).not.toMatch(/demo-|\.gif/);

    expect(/git commit -m "([^"]+)"/.exec(text)?.[1]).toMatch(/^chore\(visuals\): [ -~]+$/);
    expect(/--title "([^"]+)"/.exec(text)?.[1]).toMatch(/^chore\(visuals\): [ -~]+$/);

    expect(text).not.toMatch(/gh pr merge|--auto\b|auto-merge|automerge/i);
  });

  it("holidays-refresh.yml regenerates figures into the same PR commit (M31)", () => {
    const text = read(".github/workflows/holidays-refresh.yml");
    const gen = stepIndex(text, /^\s*run: npm run visuals$/m);
    const pr = stepIndex(text, /gh pr create/);
    expect(gen > 0 && gen < pr).toBe(true);
    expect(steps(text)[gen]).toContain("if: steps.refresh.outputs.code == '10'");
    expect(text).not.toContain("continue-on-error");
    expect([...text.matchAll(/git add[^\n]*/g)].map((m) => m[0])).toEqual([
      "git add -- data/holidays.json 'assets/*.svg'",
    ]);
  });

  it.runIf(hasActionlint)("actionlint passes", () => {
    const res = spawnSync("actionlint", [...WORKFLOWS], { cwd: root, encoding: "utf8" });
    expect(res.status, `${res.stdout}${res.stderr}`).toBe(0);
  });
});
