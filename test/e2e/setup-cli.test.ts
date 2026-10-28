import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";

const entry = fileURLToPath(new URL("../../build/index.js", import.meta.url));

beforeAll(() => {
  if (!existsSync(entry)) {
    throw new Error("build/index.js 없음: npm run build 먼저 실행");
  }
});

describe("setup e2e", () => {
  const homes: string[] = [];

  afterEach(async () => {
    for (const h of homes.splice(0)) {
      await rm(h, { recursive: true, force: true });
    }
  });

  it("setup does not start server and exits non-zero without tty", async () => {
    const home = await mkdtemp(join(tmpdir(), "kpm-setup-cli-"));
    homes.push(home);

    const child: ChildProcess = spawn(process.execPath, [entry, "setup"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...getDefaultEnvironment(), KPM_SETUP_HOME: home },
    });

    let stdout = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });

    let stderr = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });

    const send = (msg: unknown): void => {
      child.stdin?.write(JSON.stringify(msg) + "\n");
    };
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "raw", version: "0" },
      },
    });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    child.stdin?.end();

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("setup process did not exit within 15 seconds"));
      }, 15000);
      if (child.exitCode !== null || child.signalCode !== null) {
        clearTimeout(timer);
        resolve(child.exitCode);
        return;
      }
      child.once("exit", (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });

    expect(exitCode !== 0 && exitCode !== null).toBe(true);
    expect(stderr).toContain("대화형 터미널");

    for (const line of stdout.split("\n")) {
      if (line.trim() === "") continue;
      let parsed: { id?: unknown } | undefined;
      try {
        parsed = JSON.parse(line) as { id?: unknown };
      } catch {
        parsed = undefined;
      }
      if (parsed !== undefined) {
        expect(parsed.id === 1 || parsed.id === 2).toBe(false);
      }
    }

    expect(await readdir(home)).toEqual([]);
  });
});
