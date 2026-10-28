import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";

const entry = fileURLToPath(new URL("../../build/index.js", import.meta.url));

beforeAll(() => {
  if (!existsSync(entry)) {
    throw new Error("build/index.js 없음: npm run build 먼저 실행");
  }
});

describe("stdio e2e", () => {
  let client: Client | undefined;

  afterEach(async () => {
    await client?.close();
    client = undefined;
  });

  it("SDK client initialize + tools/list over stdio", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [entry],
      env: { ...getDefaultEnvironment(), KPM_LOG_LEVEL: "warn" },
      stderr: "pipe",
    });
    client = new Client({ name: "e2e", version: "0" });
    await client.connect(transport);

    expect(client.getServerVersion()?.name).toBe("korean-parenting-mcp");
    expect(client.getInstructions()).toContain("비공식");

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual([]);

    const unknown = await client.callTool({ name: "nope", arguments: {} });
    expect(unknown.isError).toBe(true);

    const again = await client.listTools();
    expect(again.tools.map((t) => t.name)).toEqual([]);
  });

  it("stdout carries only JSON-RPC lines", async () => {
    const child: ChildProcess = spawn(process.execPath, [entry], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });

    const send = (msg: unknown): void => {
      child.stdin?.write(JSON.stringify(msg) + "\n");
    };

    const responseIds = (): Set<number> => {
      const ids = new Set<number>();
      for (const line of stdout.split("\n")) {
        if (line.trim() === "") continue;
        try {
          const parsed = JSON.parse(line) as { id?: unknown };
          if (typeof parsed.id === "number") ids.add(parsed.id);
        } catch {
          // non-JSON lines are checked after the wait
        }
      }
      return ids;
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
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "nope", arguments: {} } });

    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const ids = responseIds();
      if (ids.has(1) && ids.has(2) && ids.has(3)) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    child.stdin?.end();
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve();
        return;
      }
      child.once("exit", () => resolve());
    });

    const lines = stdout.split("\n").filter((line) => line.trim() !== "");
    const parsed = lines.map((line) => JSON.parse(line) as { jsonrpc?: unknown; id?: unknown; result?: { isError?: unknown } });
    for (const msg of parsed) {
      expect(msg.jsonrpc).toBe("2.0");
    }

    const callResponse = parsed.find((msg) => msg.id === 3);
    expect(callResponse?.result?.isError).toBe(true);
  });
});
