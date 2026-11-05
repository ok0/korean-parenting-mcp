import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { MCPB_ASSET } from "../scripts/docs/links.js";
import { OUTPUT_FILE } from "../scripts/lib/mcpb.js";
import {
  MCP_PUBLISHER,
  USES,
  block,
  blockIndex,
  mcpRegistryProblems,
  mcpbReleaseProblems,
  npmPublishProblems,
  runScript,
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
  ".github/workflows/npm-publish.yml",
  ".github/workflows/mcp-registry.yml",
] as const;

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

const hasActionlint = spawnSync("actionlint", ["-version"]).status === 0;

function swapSteps(text: string, i: number, j: number): string {
  const s = steps(text);
  [s[i], s[j]] = [s[j] ?? "", s[i] ?? ""];
  return s.join("      - ");
}

function dropStep(text: string, i: number): string {
  const s = steps(text);
  s.splice(i, 1);
  return s.join("      - ");
}

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
    expect(text).toMatch(/node:\s*\[\s*"22",\s*"24"\s*\]/);
    expect(text).toContain("${{ matrix.node }}");
    expect(text.match(/if: matrix\.node == '22'/g)?.length ?? 0).toBe(2);
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
    expect(text).toContain('echo "main 브랜치의 최신 상태로 자동으로 만든 시험판(Pre-release)입니다. 정식 버전 번호 없이 main 변경마다 새로 만들어져요."');
    expect(text).not.toMatch(/아니|아닌|아님|아닙/);
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

  it("npm-publish.yml (PUB3 R1–R9)", () => {
    const text = read(".github/workflows/npm-publish.yml");
    expect(npmPublishProblems(text)).toEqual([]);
    expect(text).not.toMatch(/아니|아닌|아님|아닙/);

    const swappedSteps = steps(text);
    const verifyIdx = stepIndex(text, /^run: npm run verify\s*$/m);
    const publishIdx = stepIndex(text, /^ {8}run: npm stage publish\s*$/m);
    [swappedSteps[verifyIdx], swappedSteps[publishIdx]] = [
      swappedSteps[publishIdx] ?? "",
      swappedSteps[verifyIdx] ?? "",
    ];
    const swapped = swappedSteps.join("      - ");

    const samples = [
      swapped,
      text.replace("run: npm stage publish", "run: npm stage publish --provenance"),
      text.replace("  id-token: write\n", ""),
      text.replace('    tags: ["v*"]', '    tags: ["v*"]\n  workflow_dispatch:'),
      text.replace("  contents: read", "  contents: write"),
      text.replace('node-version: "22"', 'node-version: "20"'),
      text.replace("run: npm run verify", "run: npm run verify || true"),
      text.replace("run: npm stage publish", "run: npm publish"),
      text.replace(
        "      - name: stage publish\n",
        "      - name: stage publish\n        env:\n          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}\n",
      ),
      text.replace("npm install -g npm@11.21.1", "npm install -g npm@11.14.0"),
      text.replace("cancel-in-progress: false", "cancel-in-progress: true"),
      text.replace(/^ {4}timeout-minutes: \d+\n/m, ""),
      text.replace("GITHUB_REF_NAME", "GITHUB_SHA"),
      text.replaceAll("Staged Packages", "Packages"),
      text.replace("          package-manager-cache: false\n", ""),
    ];
    expect(samples).toHaveLength(15);
    for (const sample of samples) {
      expect(sample).not.toBe(text);
      expect(npmPublishProblems(sample).length).toBeGreaterThan(0);
    }
    const withCache = text.replace("          package-manager-cache: false\n", "          package-manager-cache: false\n          cache: npm\n");
    expect(withCache).not.toBe(text);
    expect(npmPublishProblems(withCache).length).toBeGreaterThan(0);
  });

  it.skipIf(process.platform === "win32")(
    "npm-publish.yml check scripts pass on match and fail on mismatch (PUB3 AC2)",
    () => {
      const text = read(".github/workflows/npm-publish.yml");
      const version = (JSON.parse(read("package.json")) as { version: string }).version;
      const dir = mkdtempSync(join(tmpdir(), "kpm-npm-stub-"));
      try {
        const stub = join(dir, "npm");
        writeFileSync(
          stub,
          [
            "#!/bin/sh",
            'if [ "$1" = "--version" ]; then echo "$STUB_NPM_VERSION"; exit 0; fi',
            'if [ "$1" = "view" ]; then',
            '  if [ -n "$STUB_NPM_VIEW" ]; then echo "$STUB_NPM_VIEW"; fi',
            '  exit "${STUB_NPM_EXIT:-0}"',
            "fi",
            "exit 99",
            "",
          ].join("\n"),
        );
        chmodSync(stub, 0o755);

        const run = (script: string, env: Record<string, string>) =>
          spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", script], {
            cwd: root,
            encoding: "utf8",
            env: {
              ...process.env,
              PATH: `${dir}:${process.env.PATH ?? ""}`,
              STUB_NPM_VERSION: "",
              STUB_NPM_VIEW: "",
              STUB_NPM_EXIT: "0",
              ...env,
            },
          });

        const tag = runScript(text, "check tag matches package version");
        const view = runScript(text, "check version is new on npm");
        const gate = runScript(text, "check npm version");
        expect(tag.trim()).not.toBe("");
        expect(view.trim()).not.toBe("");
        expect(gate.trim()).not.toBe("");

        expect(run(tag, { GITHUB_REF_NAME: `v${version}` }).status).toBe(0);
        const mismatch = run(tag, { GITHUB_REF_NAME: "v0.0.0-mismatch" });
        expect(mismatch.status).not.toBe(0);
        const mismatchOut = `${mismatch.stdout}${mismatch.stderr}`;
        expect(mismatchOut).toContain("0.0.0-mismatch");
        expect(mismatchOut).toContain(version);

        expect(run(view, { STUB_NPM_VIEW: "", STUB_NPM_EXIT: "1" }).status).toBe(0);
        expect(run(view, { STUB_NPM_VIEW: "", STUB_NPM_EXIT: "0" }).status).toBe(0);
        const dup = run(view, { STUB_NPM_VIEW: version, STUB_NPM_EXIT: "0" });
        expect(dup.status).not.toBe(0);
        expect(`${dup.stdout}${dup.stderr}`).toContain("already published");

        for (const v of ["11.15.0", "11.21.1", "12.0.0"]) {
          const res = run(gate, { STUB_NPM_VERSION: v });
          expect(res.status).toBe(0);
          expect(`${res.stdout}${res.stderr}`).toContain(v);
        }
        for (const v of ["11.14.9", "10.9.2"]) {
          expect(run(gate, { STUB_NPM_VERSION: v }).status).not.toBe(0);
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it("mcp-registry.yml (M68 R1–R8)", () => {
    const text = read(".github/workflows/mcp-registry.yml");
    expect(mcpRegistryProblems(text)).toEqual([]);
    expect(text).not.toMatch(/아니|아닌|아님|아닙/);
    expect(text).toContain(`MCP_PUBLISHER_VERSION: "${MCP_PUBLISHER.version}"`);
    expect(text).toContain(`MCP_PUBLISHER_SHA256: "${MCP_PUBLISHER.sha256}"`);

    const npmIdx = stepIndex(text, /npm view /);
    const installIdx = stepIndex(text, /sha256sum -c/);
    const loginIdx = stepIndex(text, /^ {8}run: \.\/mcp-publisher login github-oidc\s*$/m);
    const publishIdx = stepIndex(text, /^ {8}run: \.\/mcp-publisher publish\s*$/m);

    const samples = [
      // trigger: an added push trigger
      text.replace("  workflow_dispatch:\n", "  workflow_dispatch:\n  push:\n    branches: [main]\n"),
      // permissions: broader contents or extra permission
      text.replace("  contents: read\n", "  contents: write\n"),
      text.replace("  id-token: write\n", "  id-token: write\n  packages: write\n"),
      // secret reference
      text.replace("        run: ./mcp-publisher publish\n", "        env:\n          MCP_TOKEN: ${{ secrets.MCP_TOKEN }}\n        run: ./mcp-publisher publish\n"),
      // missing verify step
      text.replace("      - run: npm run verify\n", ""),
      text.replace("run: npm run verify", "run: npm run verify || true"),
      text.replace("    if: github.ref == 'refs/heads/main'\n", ""),
      text.replace("releases/download/v${MCP_PUBLISHER_VERSION}/", "releases/latest/download/"),
      text.replace(" | sha256sum -c -", " > /dev/null"),
      text.replace(MCP_PUBLISHER.sha256, "0".repeat(64)),
      text.replace(`MCP_PUBLISHER_VERSION: "${MCP_PUBLISHER.version}"`, 'MCP_PUBLISHER_VERSION: "1.8.6"'),
      swapSteps(text, npmIdx, installIdx),
      swapSteps(text, loginIdx, publishIdx),
      text.replace("login github-oidc", "login github"),
      text.replace("cancel-in-progress: false", "cancel-in-progress: true"),
      text.replace("      - name: publish to MCP Registry\n", "      - name: publish to MCP Registry\n        if: always()\n"),
      dropStep(text, npmIdx),
      text.replace("          package-manager-cache: false\n", ""),
    ];
    expect(samples).toHaveLength(18);
    for (const sample of samples) {
      expect(sample).not.toBe(text);
      expect(mcpRegistryProblems(sample).length).toBeGreaterThan(0);
    }
    const withCache = text.replace("          package-manager-cache: false\n", "          package-manager-cache: false\n          cache: npm\n");
    expect(withCache).not.toBe(text);
    expect(mcpRegistryProblems(withCache).length).toBeGreaterThan(0);
  });

  it.skipIf(process.platform === "win32")(
    "mcp-registry.yml npm public check passes only for a public version with matching mcpName (M68 R5)",
    () => {
      const text = read(".github/workflows/mcp-registry.yml");
      const server = JSON.parse(read("server.json")) as {
        name: string;
        packages: { identifier: string; version: string }[];
      };
      const target = `${server.packages[0]!.identifier}@${server.packages[0]!.version}`;
      const dir = mkdtempSync(join(tmpdir(), "kpm-registry-npm-stub-"));
      try {
        const stub = join(dir, "npm");
        writeFileSync(
          stub,
          [
            "#!/bin/sh",
            'if [ "$1" = "view" ] && [ "$2" = "$STUB_EXPECT" ] && [ "$3" = "mcpName" ]; then',
            '  if [ -n "$STUB_NPM_VIEW" ]; then echo "$STUB_NPM_VIEW"; fi',
            '  exit "${STUB_NPM_EXIT:-0}"',
            "fi",
            "exit 99",
            "",
          ].join("\n"),
        );
        chmodSync(stub, 0o755);

        const run = (script: string, env: Record<string, string>) =>
          spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", script], {
            cwd: root,
            encoding: "utf8",
            env: {
              ...process.env,
              PATH: `${dir}:${process.env.PATH ?? ""}`,
              STUB_EXPECT: target,
              STUB_NPM_VIEW: "",
              STUB_NPM_EXIT: "0",
              ...env,
            },
          });

        const script = runScript(text, "check version is public on npm");
        expect(script.trim()).not.toBe("");

        const ok = run(script, { STUB_NPM_VIEW: server.name, STUB_NPM_EXIT: "0" });
        expect(ok.status).toBe(0);
        expect(`${ok.stdout}${ok.stderr}`).toContain(server.name);

        const missing = run(script, { STUB_NPM_VIEW: "", STUB_NPM_EXIT: "1" });
        expect(missing.status).not.toBe(0);
        const missingOut = `${missing.stdout}${missing.stderr}`;
        expect(missingOut).toContain(target);
        expect(missingOut).toContain("npm check");

        expect(run(script, { STUB_NPM_VIEW: "", STUB_NPM_EXIT: "0" }).status).not.toBe(0);
        expect(run(script, { STUB_NPM_VIEW: "io.github.someone/other", STUB_NPM_EXIT: "0" }).status).not.toBe(0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

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
