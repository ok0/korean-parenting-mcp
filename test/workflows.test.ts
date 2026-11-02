import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { MCPB_ASSET } from "../scripts/docs/links.js";
import { OUTPUT_FILE } from "../scripts/lib/mcpb.js";
import {
  USES,
  block,
  blockIndex,
  mcpbReleaseProblems,
  secretNames,
  stepIndex,
  steps,
  topPermissions,
} from "./helpers/workflows.js";

const root = fileURLToPath(new URL("../", import.meta.url));

const WORKFLOWS = [
  ".github/workflows/ci.yml",
  ".github/workflows/revision-check.yml",
  ".github/workflows/holidays-refresh.yml",
  ".github/workflows/visuals-refresh.yml",
  ".github/workflows/pages.yml",
  ".github/workflows/mcpb-release.yml",
] as const;

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
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
    expect(text).toMatch(/^  push:\n    branches: \[main\]\n    paths: \["data\/\*\*", "src\/\*\*", "scripts\/visuals\/\*\*", "test\/fixtures\/visuals\/\*\*"\]$/m);
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

  it("pages.yml (M33)", () => {
    const text = read(".github/workflows/pages.yml");
    expect(text).toContain("branches: [main]");
    expect(text).toContain('    paths: ["site/**", "assets/**", "src/**", "data/**", "scripts/build-site.ts"]');
    expect(text).toMatch(/^\s+workflow_dispatch:/m);
    expect(text).not.toMatch(/pull_request|schedule:/);

    expect(topPermissions(text)).toEqual({ contents: "read", pages: "write", "id-token": "write" });
    expect(text).toContain("group: pages");

    const order = [
      /actions\/checkout@/,
      /actions\/setup-node@/,
      /^\s*run: npm ci$/m,
      /^\s*run: npm run build:site$/m,
      /actions\/configure-pages@/,
      /actions\/upload-pages-artifact@/,
    ].map((re) => stepIndex(text, re));
    for (const i of order) expect(i).toBeGreaterThanOrEqual(0);
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1]! < order[i]!).toBe(true);
    }
    expect(block(text, "upload-pages-artifact")).toContain("path: build-site");
    expect(block(text, "setup-node")).toContain('node-version: "22"');

    expect(text).toContain("needs: build");
    expect(text).toContain("name: github-pages");
    expect(text).toMatch(/uses: actions\/deploy-pages@v\d+\.\d+\.\d+/);
    expect(stepIndex(text, /deploy-pages/)).toBeGreaterThan(stepIndex(text, /upload-pages-artifact/));

    expect(secretNames(text)).toEqual([]);
    expect(text).not.toContain("continue-on-error");
  });

  it("mcpb-release.yml (M38 R1–R3, R7)", () => {
    const text = read(".github/workflows/mcpb-release.yml");
    expect(mcpbReleaseProblems(text)).toEqual([]);
    expect(OUTPUT_FILE).toBe(MCPB_ASSET);

    const swappedSteps = steps(text);
    const smokeIdx = stepIndex(text, /^\s*run: npm run smoke:mcpb$/m);
    const publishIdx = stepIndex(text, /gh release upload/);
    [swappedSteps[smokeIdx], swappedSteps[publishIdx]] = [
      swappedSteps[publishIdx] ?? "",
      swappedSteps[smokeIdx] ?? "",
    ];
    const swapped = swappedSteps.join("      - ");

    const samples = [
      swapped,
      text.replace("  contents: write", "  contents: write\n  pull-requests: write"),
      text.replace("  workflow_dispatch:", "  workflow_dispatch:\n  pull_request:"),
      text.replace(" --clobber", ""),
      text.replace(
        "      - name: publish rolling prerelease",
        "      - name: publish rolling prerelease\n        if: always()",
      ),
      text.replace("GH_TOKEN: ${{ github.token }}", "GH_TOKEN: ${{ secrets.PAT }}"),
      text.replace("run: npm run verify", "run: npm run verify || true"),
      text.replace("::warning", "::notice"),
      text.replace("자료를 이용해 정리해 드려요. 최종 확인은 해당 기관에서 해 주세요.", "자료를 이용해 정리해 드려요."),
      text.replace('            echo "공공기관이', '            echo "개인 프로젝트입니다."\n            echo "공공기관이'),
    ];
    for (const sample of samples) {
      expect(mcpbReleaseProblems(sample).length).toBeGreaterThan(0);
    }
  });

  it("contents: write set is pinned and only mcpb-release writes releases (M38 R3)", () => {
    const writers = WORKFLOWS.filter((f) => topPermissions(read(f)).contents === "write").sort();
    expect(writers).toEqual(
      [
        ".github/workflows/holidays-refresh.yml",
        ".github/workflows/visuals-refresh.yml",
        ".github/workflows/mcpb-release.yml",
      ].sort(),
    );
    for (const f of WORKFLOWS.filter((f) => f !== ".github/workflows/mcpb-release.yml")) {
      expect(read(f)).not.toMatch(/gh release|refs\/tags|git tag/);
    }
  });

  it.runIf(hasActionlint)("actionlint passes", () => {
    const res = spawnSync("actionlint", [...WORKFLOWS], { cwd: root, encoding: "utf8" });
    expect(res.status, `${res.stdout}${res.stderr}`).toBe(0);
  });
});
