import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { KEY_ENV } from "../src/core/config.js";
import { BUILD_INFO_FILE, checkMcpbRelease, resolveBuildCommit } from "./lib/mcpb-release.js";
import { OUTPUT_FILE } from "./lib/mcpb.js";
import { runMcpSession, type SessionResult, type ToolCall } from "./lib/mcp-session.js";

const root = fileURLToPath(new URL("../../", import.meta.url));

const FAKE = "kpmFAKE+key/9=x";
const ENCODED = encodeURIComponent(FAKE);
const packScript = join(root, "build-scripts/scripts/build-mcpb.js");
const keyNames = Object.values(KEY_ENV);
const ALLOWED_DATA = /^data\/[^/]+\.json$/;
const FORBIDDEN = ["node_modules/", "test/", "fixtures", "scripts/", ".docs/", ".ensemble/", ".github/", ".map", ".bak", ".key.txt", "Dockerfile", ".dockerignore", "deploy/", "build/remote", "remote-smoke", "container-smoke"];

const calls: ToolCall[] = [
  { name: "get_timeline", arguments: { reference_date: "2026-10-28", birth_date: "2026-05-28" } },
  { name: "get_leave_article", arguments: { topic: "maternity_leave" } },
];

function listEntries(mcpb: string): string[] {
  const out = execFileSync("unzip", ["-Z1", mcpb], { encoding: "utf8" });
  return out
    .split("\n")
    .filter((line) => line !== "" && !line.endsWith("/"))
    .sort();
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const path = join(dir, d.name);
    return d.isDirectory() ? walk(path) : [path];
  });
}

function toolNames(session: SessionResult): string[] {
  return (session.byId(2)?.result?.tools ?? []).map((tool) => tool.name).sort();
}

async function main(): Promise<void> {
  if (process.platform === "win32") {
    process.stderr.write("mcpb-smoke는 POSIX 환경에서만 실행합니다.\n");
    process.exitCode = 1;
    return;
  }
  const unzipCheck = spawnSync("unzip", ["-v"], { encoding: "utf8" });
  if (unzipCheck.error || unzipCheck.status !== 0) {
    throw new Error("unzip 명령이 필요합니다");
  }
  const expectedCommit = resolveBuildCommit(process.env);

  const work = mkdtempSync(join(tmpdir(), "kpm-mcpb-"));
  try {
    const mcpb = join(root, "build-mcpb", OUTPUT_FILE);
    const fakeEnv: NodeJS.ProcessEnv = Object.fromEntries(keyNames.map((name) => [name, FAKE]));

    const broken = spawnSync(process.execPath, [packScript], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        KPM_MCPB_MANIFEST: "test/fixtures/mcpb/manifest-broken.json",
        KPM_MCPB_OUT_DIR: join(work, "neg"),
      },
    });
    assert.notEqual(broken.status, 0, "깨진 manifest로 포장이 통과했습니다");
    assert.ok(!existsSync(join(work, "neg", OUTPUT_FILE)), "깨진 manifest로 .mcpb가 만들어졌습니다");

    const badCommit = spawnSync(process.execPath, [packScript], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        KPM_BUILD_COMMIT: "not-a-sha",
        KPM_MCPB_OUT_DIR: join(work, "badcommit"),
      },
    });
    assert.notEqual(badCommit.status, 0, "잘못된 KPM_BUILD_COMMIT로 포장이 통과했습니다");
    assert.ok(!existsSync(join(work, "badcommit", OUTPUT_FILE)), "잘못된 KPM_BUILD_COMMIT로 .mcpb가 만들어졌습니다");

    const packEnv: NodeJS.ProcessEnv = { ...process.env, KPM_MCPB_MANIFEST: "", KPM_MCPB_OUT_DIR: "", ...fakeEnv };
    const lists: string[][] = [];
    for (let i = 0; i < 2; i++) {
      const run = spawnSync(process.execPath, [packScript], { cwd: root, encoding: "utf8", env: packEnv });
      assert.equal(run.status, 0, "포장 스크립트가 실패했습니다");
      const output = `${run.stdout}${run.stderr}`;
      assert.ok(!output.includes(FAKE) && !output.includes(ENCODED), "포장 출력에 가짜 키가 있습니다");
      lists.push(listEntries(mcpb));
    }
    assert.deepEqual(lists[1], lists[0], "두 번 포장한 항목 목록이 다릅니다");
    const entries = lists[0] ?? [];

    const ignored = (rel: string): boolean =>
      spawnSync("git", ["check-ignore", "-q", rel], { cwd: root }).status === 0;
    assert.ok(ignored("build-mcpb/korean-parenting-mcp.mcpb"), "build-mcpb/korean-parenting-mcp.mcpb는 git 무시 대상이어야 합니다");
    assert.ok(ignored("build-mcpb/stage/server/index.mjs"), "build-mcpb/stage/server/index.mjs는 git 무시 대상이어야 합니다");
    const gitStatus = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: root, encoding: "utf8" });
    assert.ok(!gitStatus.includes("build-mcpb") && !gitStatus.includes(".mcpb"), "git status에 build-mcpb 산출물이 보입니다");
    const dryRun = JSON.parse(
      execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: root, encoding: "utf8" }),
    ) as { files: { path: string }[] }[];
    const packed = (dryRun[0]?.files ?? []).map((file) => file.path);
    assert.ok(
      !packed.some((p) => p.startsWith("build-mcpb/") || p.endsWith(".mcpb")),
      "npm pack 목록에 build-mcpb 산출물이 있습니다",
    );

    const allowed = (p: string): boolean =>
      p === "manifest.json" || p === ".mcpbignore" || p === "server/index.mjs" || p === BUILD_INFO_FILE || ALLOWED_DATA.test(p);
    assert.deepEqual(entries.filter((p) => !allowed(p)), [], "허용되지 않은 항목이 있습니다");
    const sourceManifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")) as {
      server: { entry_point: string };
    };
    const required = ["manifest.json", BUILD_INFO_FILE, sourceManifest.server.entry_point, ...readdirSync(join(root, "data")).map((n) => `data/${n}`)];
    for (const item of required) {
      assert.ok(entries.includes(item), `필수 항목이 없습니다: ${item}`);
    }
    for (const p of entries) {
      for (const bad of FORBIDDEN) {
        assert.ok(!p.includes(bad), `금지 항목이 포함되어 있습니다: ${p}`);
      }
    }

    const ext = join(work, "ext");
    const unzipped = spawnSync("unzip", ["-q", mcpb, "-d", ext], { encoding: "utf8" });
    assert.equal(unzipped.status, 0, "unzip이 실패했습니다");
    assert.ok(!existsSync(join(ext, "node_modules")), "풀린 번들에 node_modules가 있습니다");
    for (const file of walk(ext)) {
      const buf = readFileSync(file);
      assert.ok(
        !buf.includes(FAKE) && !buf.includes(ENCODED),
        `풀린 파일에 가짜 키가 있습니다: ${relative(ext, file)}`,
      );
    }
    const extManifest = JSON.parse(readFileSync(join(ext, "manifest.json"), "utf8")) as {
      server: { mcp_config: { command: string; args: string[] } };
    };
    const releaseIssues = checkMcpbRelease({
      manifestJson: readFileSync(join(ext, "manifest.json"), "utf8"),
      buildInfoJson: readFileSync(join(ext, BUILD_INFO_FILE), "utf8"),
      expectedCommit,
    });
    assert.deepEqual(releaseIssues, [], "번들 build-info/manifest 검사 실패");
    const mcpConfig = extManifest.server.mcp_config;
    const bundleArgs = mcpConfig.args.map((arg) => arg.replaceAll("${__dirname}", ext));
    assert.ok(existsSync(bundleArgs[0] ?? ""), `번들 진입점이 없습니다: ${bundleArgs[0] ?? ""}`);
    assert.equal(mcpConfig.command, "node");

    const reference = await runMcpSession({
      command: process.execPath,
      args: [join(root, "build/index.js")],
      cwd: work,
      env: { PATH: process.env.PATH ?? "", HOME: work },
      calls: [],
    });
    const refTools = toolNames(reference);

    mkdirSync(join(work, "cwd"));
    const cases: [string, NodeJS.ProcessEnv][] = [
      ["unset", {}],
      ["empty", Object.fromEntries(keyNames.map((name) => [name, ""]))],
      ["placeholder", Object.fromEntries(keyNames.map((name) => [name, `\${user_config.${name}}`]))],
    ];
    for (const [label, extra] of cases) {
      const session = await runMcpSession({
        command: process.execPath,
        args: bundleArgs,
        cwd: join(work, "cwd"),
        env: { PATH: process.env.PATH ?? "", HOME: work, ...extra },
        calls,
      });
      assert.deepEqual(session.nonJsonLines, [], `${label}: stdout의 모든 줄은 JSON-RPC 메시지여야 합니다`);
      for (const msg of session.messages) {
        assert.equal(msg.jsonrpc, "2.0", `${label}: 모든 메시지는 JSON-RPC 2.0이어야 합니다`);
      }
      assert.ok(session.byId(1)?.result, `${label}: initialize 응답이 없습니다`);
      assert.deepEqual(toolNames(session), refTools, `${label}: tools 목록이 기준과 다릅니다`);
      assert.ok(session.byId(3)?.result, `${label}: get_timeline 응답이 없습니다`);
      assert.notEqual(session.byId(3)?.result?.isError, true, `${label}: get_timeline이 오류를 반환했습니다`);
      assert.equal(session.byId(4)?.result?.isError, true, `${label}: get_leave_article이 오류를 반환하지 않았습니다`);
      assert.ok(
        (session.byId(4)?.result?.content ?? []).some((c) => (c.text ?? "").includes("LAW_OC")),
        `${label}: get_leave_article 오류 텍스트에 LAW_OC가 없습니다`,
      );
      assert.ok(!session.stderr.includes("시작 실패"), `${label}: stderr에 시작 실패가 있습니다`);
      assert.ok(!session.stderr.includes("데이터 디렉터리"), `${label}: stderr에 데이터 디렉터리 오류가 있습니다`);
    }

    const nodata = join(work, "nodata");
    cpSync(ext, nodata, { recursive: true });
    rmSync(join(nodata, "data"), { recursive: true, force: true });
    const noData = await runMcpSession({
      command: process.execPath,
      args: [join(nodata, "server", "index.mjs")],
      cwd: join(work, "cwd"),
      env: { PATH: process.env.PATH ?? "", HOME: work },
      calls: calls.slice(0, 1),
    });
    const noDataTimeline = noData.byId(3)?.result;
    assert.ok(
      noDataTimeline === undefined || noDataTimeline.isError === true,
      "data/ 없이도 get_timeline이 성공했습니다",
    );

    process.stdout.write(`MCPB SMOKE PASS (${OUTPUT_FILE}, ${entries.length} entries)\n`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
