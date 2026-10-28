import { spawn } from "node:child_process";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";

export interface RpcMessage {
  jsonrpc?: string;
  id?: number;
  result?: {
    tools?: { name: string }[];
    isError?: boolean;
    content?: { type: string; text?: string }[];
  };
  error?: unknown;
}

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface SessionResult {
  messages: RpcMessage[];
  nonJsonLines: string[];
  stderr: string;
  byId(id: number): RpcMessage | undefined;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function parseLines(lines: string[]): { messages: RpcMessage[]; nonJsonLines: string[] } {
  const messages: RpcMessage[] = [];
  const nonJsonLines: string[] = [];
  for (const line of lines) {
    if (line.trim() === "") continue;
    try {
      messages.push(JSON.parse(line) as RpcMessage);
    } catch {
      nonJsonLines.push(line);
    }
  }
  return { messages, nonJsonLines };
}

export async function runMcpSession(opts: {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  calls: ToolCall[];
}): Promise<SessionResult> {
  const child = spawn(opts.command, opts.args, { cwd: opts.cwd, env: opts.env, stdio: "pipe" });
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
    parseLines(stdout.split("\n").slice(0, -1)).messages.some((msg) => msg.id === id);
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
      clientInfo: { name: "kpm-mcpb-smoke", version: "0" },
    },
  });
  await waitFor([1]);
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  opts.calls.forEach((call, i) => {
    send({
      jsonrpc: "2.0",
      id: 3 + i,
      method: "tools/call",
      params: { name: call.name, arguments: call.arguments },
    });
  });
  await waitFor([2, ...opts.calls.map((_, i) => 3 + i)]);

  child.stdin.end();
  await Promise.race([exit, sleep(10000)]);
  if (!exited) {
    child.kill();
  }
  await exit;

  const parsed = parseLines(stdout.split("\n"));
  return {
    messages: parsed.messages,
    nonJsonLines: parsed.nonJsonLines,
    stderr,
    byId: (id: number) => parsed.messages.find((msg) => msg.id === id),
  };
}
