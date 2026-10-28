import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";

const entry = fileURLToPath(new URL("../../build/index.js", import.meta.url));

const SCENARIO_A = { reference_date: "2026-10-28", due_date: "2027-02-10", birth_order: 1, fetus_count: 1, region: "성동구" };
const SCENARIO_B = { reference_date: "2026-10-28", birth_date: "2026-05-28" };

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
    expect(client.getInstructions()).toContain("get_timeline");
    expect(client.getInstructions()).toContain("get_leave_article");

    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("get_timeline");
    expect(names).toContain("get_leave_article");

    const unknown = await client.callTool({ name: "nope", arguments: {} });
    expect(unknown.isError).toBe(true);

    const tl = await client.callTool({
      name: "get_timeline",
      arguments: { birth_date: "2026-01-31", reference_date: "2026-02-01" },
    });
    expect(tl.isError).toBeFalsy();
    const tlText = (tl.content as { type: string; text: string }[])[0]!.text;
    expect(tlText).toContain("출생신고 기한");
    expect(tlText).toContain("비공식");

    const pregnantCall = await client.callTool({ name: "get_timeline", arguments: SCENARIO_A });
    expect(pregnantCall.isError).toBeFalsy();
    const pregnantText = (pregnantCall.content as { type: string; text: string }[])[0]!.text;
    expect(pregnantText).toContain("출산예정일 2027-02-10");
    expect(pregnantText).toContain("근거 문서:");
    expect(pregnantText).toContain("의료·법률 면책");

    const bornCall = await client.callTool({ name: "get_timeline", arguments: SCENARIO_B });
    expect(bornCall.isError).toBeFalsy();
    const bornText = (bornCall.content as { type: string; text: string }[])[0]!.text;
    expect(bornText).toContain("출생일 2026-05-28");

    const leave = await client.callTool({ name: "get_leave_article", arguments: { topic: "maternity_leave" } });
    expect(leave.isError).toBe(true);
    expect((leave.content as { type: string; text: string }[])[0]!.text).toContain("LAW_OC");

    const again = await client.listTools();
    const againNames = again.tools.map((t) => t.name);
    expect(againNames).toContain("get_timeline");
    expect(againNames).toContain("get_leave_article");
  });

  it("stdout carries only JSON-RPC lines", async () => {
    const child: ChildProcess = spawn(process.execPath, [entry], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...getDefaultEnvironment() },
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
    send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "get_timeline", arguments: SCENARIO_A } });
    send({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "get_timeline", arguments: SCENARIO_B } });

    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const ids = responseIds();
      if (ids.has(1) && ids.has(2) && ids.has(3) && ids.has(4) && ids.has(5)) break;
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

    for (const id of [4, 5]) {
      const scenarioResponse = parsed.find((msg) => msg.id === id);
      expect(scenarioResponse).toBeDefined();
      expect(scenarioResponse?.result?.isError).not.toBe(true);
    }

    for (const secret of ["2027-02-10", "2026-05-28", "성동구"]) {
      expect(stderr).not.toContain(secret);
    }
  });
});
