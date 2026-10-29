import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { rawRequest } from "../helpers/remote-server.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const MAIN = join(root, "build/remote/main.js");

interface Run {
  child: ChildProcess;
  stderr(): string;
  exit: Promise<number | null>;
}

function launch(extra: Record<string, string>): Run {
  const child = spawn(process.execPath, [MAIN], {
    cwd: root,
    env: { PATH: process.env.PATH ?? "", ...extra },
  });
  let err = "";
  child.stderr?.on("data", (d: Buffer) => {
    err += d.toString();
  });
  const exit = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
  return { child, stderr: () => err, exit };
}

async function waitForMatch(run: Run, re: RegExp, ms: number): Promise<RegExpExecArray> {
  const deadline = Date.now() + ms;
  for (;;) {
    const m = re.exec(run.stderr());
    if (m) return m;
    if (Date.now() > deadline) throw new Error("timed out waiting for stderr");
    await new Promise((r) => setTimeout(r, 50));
  }
}

beforeAll(() => {
  if (!existsSync(MAIN)) throw new Error("run npm run build");
});

describe("remote entry point", () => {
  it("invalid port exits 1 with item name only", async () => {
    const run = launch({ KPM_HTTP_PORT: "abc" });
    expect(await run.exit).toBe(1);
    expect(run.stderr()).toContain("KPM_HTTP_PORT");
    expect(run.stderr()).not.toContain("abc");
  });

  it("short bearer token exits 1 with item name only", async () => {
    const value = "short-token-value-123";
    const run = launch({ KPM_REMOTE_BEARER_TOKEN: value });
    expect(await run.exit).toBe(1);
    expect(run.stderr()).toContain("KPM_REMOTE_BEARER_TOKEN");
    expect(run.stderr()).not.toContain(value);
  });

  it("listens and stops on SIGTERM", async () => {
    const run = launch({ KPM_HTTP_PORT: "0" });
    const m = await waitForMatch(run, /listening on 127\.0.0\.1:(\d+)/, 10_000);
    const port = Number(m[1]);

    const health = await rawRequest(port, { method: "GET", path: "/healthz" });
    expect(health.status).toBe(200);

    const sse = await rawRequest(port, {
      method: "GET",
      path: "/mcp",
      headers: { accept: "text/event-stream" },
      untilHeaders: true,
    });
    expect(sse.status).toBe(200);

    run.child.kill("SIGTERM");
    const code = await Promise.race([
      run.exit,
      new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 10_000)),
    ]);
    sse.destroy();
    expect(code).toBe(0);
  });
});
