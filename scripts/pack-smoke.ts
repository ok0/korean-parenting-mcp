import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";

const root = fileURLToPath(new URL("../../", import.meta.url));

interface RpcMessage {
  jsonrpc?: string;
  id?: number;
  result?: {
    tools?: { name: string }[];
    isError?: boolean;
  };
}

interface McpRun {
  lines: string[];
  stderr: string;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function packTarball(packDir: string): { file: string; filename: string } {
  const out = execFileSync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", packDir], {
    cwd: root,
    encoding: "utf8",
  });
  const filename = (JSON.parse(out) as { filename: string }[])[0]?.filename;
  assert.ok(filename, "npm pack 결과에 filename이 없습니다");
  return { file: join(packDir, filename), filename };
}

async function mcpSession(bin: string, cwd: string, env: NodeJS.ProcessEnv): Promise<McpRun> {
  const child = spawn(bin, [], { cwd, env, stdio: "pipe" });
  child.stdin.on("error", () => undefined);
  let stdout = "";
  let stderr = "";
  let exited = false;
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const exit = new Promise<void>((resolve) => {
    child.once("exit", () => {
      exited = true;
      resolve();
    });
  });

  const send = (msg: unknown): void => {
    child.stdin.write(JSON.stringify(msg) + "\n");
  };
  const responded = (id: number): boolean =>
    stdout
      .split("\n")
      .slice(0, -1)
      .some((line) => (JSON.parse(line) as RpcMessage).id === id);
  const deadline = Date.now() + 20000;
  const waitFor = async (ids: number[]): Promise<void> => {
    while (!exited && Date.now() < deadline && !ids.every(responded)) {
      await sleep(50);
    }
  };

  send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "pack-smoke", version: "0" },
    },
  });
  await waitFor([1]);
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  send({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "get_timeline", arguments: { reference_date: "2026-10-28", birth_date: "2026-05-28" } },
  });
  await waitFor([2, 3]);

  child.stdin.end();
  await Promise.race([exit, sleep(10000)]);
  if (!exited) {
    child.kill();
  }
  await exit;

  return {
    lines: stdout.split("\n").filter((line) => line.trim() !== ""),
    stderr,
  };
}

async function main(): Promise<void> {
  if (process.platform === "win32") {
    process.stderr.write("pack-smoke는 POSIX 환경에서만 실행합니다.\n");
    process.exitCode = 1;
    return;
  }

  const work = mkdtempSync(join(tmpdir(), "kpm-pack-"));
  try {
    const packDir = join(work, "pack");
    const appDir = join(work, "app");
    const home = join(work, "home");
    mkdirSync(packDir);
    mkdirSync(appDir);
    mkdirSync(home);

    const { file, filename } = packTarball(packDir);

    writeFileSync(
      join(appDir, "package.json"),
      JSON.stringify({ name: "kpm-smoke", version: "0.0.0", private: true }) + "\n",
    );
    execFileSync(
      "npm",
      ["install", "--no-audit", "--no-fund", "--ignore-scripts", "--no-package-lock", file],
      { cwd: appDir, stdio: "inherit" },
    );

    const bin = join(appDir, "node_modules/.bin/korean-parenting-mcp");
    const realBin = realpathSync(bin);
    assert.ok(realBin.startsWith(realpathSync(appDir) + sep), `설치된 bin 위치가 예상과 다릅니다: ${realBin}`);
    assert.ok(!realBin.startsWith(realpathSync(root) + sep), `bin이 프로젝트 루트를 가리킵니다: ${realBin}`);

    const env = { PATH: process.env.PATH ?? "", HOME: home, KPM_SETUP_HOME: home };

    const run = await mcpSession(bin, appDir, env);
    const messages = run.lines.map((line) => JSON.parse(line) as RpcMessage);
    for (const msg of messages) {
      assert.equal(msg.jsonrpc, "2.0", `stdout에 JSON-RPC가 아닌 줄이 있습니다: ${JSON.stringify(msg)}`);
    }
    const byId = (id: number): RpcMessage | undefined => messages.find((msg) => msg.id === id);
    const tools = byId(2)?.result?.tools ?? [];
    assert.ok(tools.some((tool) => tool.name === "get_timeline"), "tools/list에 get_timeline이 없습니다");
    assert.ok(byId(3)?.result, "get_timeline 호출 응답이 없습니다");
    assert.notEqual(byId(3)?.result?.isError, true, "get_timeline 호출이 오류를 반환했습니다");
    assert.ok(!run.stderr.includes("시작 실패"), `stderr에 시작 실패가 있습니다: ${run.stderr}`);
    assert.ok(!run.stderr.includes("데이터 디렉터리"), `stderr에 데이터 디렉터리 오류가 있습니다: ${run.stderr}`);

    const setup = spawnSync(bin, ["setup"], { cwd: appDir, env, input: "", encoding: "utf8", timeout: 20000 });
    assert.ok(setup.status !== 0 && setup.status !== null, `setup이 0 또는 신호 종료로 끝났습니다: ${setup.status}`);
    assert.ok(setup.stderr.includes("대화형 터미널"), `setup stderr에 대화형 터미널 안내가 없습니다: ${setup.stderr}`);
    assert.deepEqual(readdirSync(home), []);

    process.stdout.write(`PACK SMOKE PASS (${filename})\n`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
