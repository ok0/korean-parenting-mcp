import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { VERSION } from "../../src/version.js";
import { rawRequest } from "../helpers/remote-server.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const MAIN = join(root, "build/remote/main.js");

interface Run {
  child: ChildProcess;
  stderr(): string;
  stdout(): string;
  exit: Promise<number | null>;
}

function launch(extra: Record<string, string>): Run {
  const child = spawn(process.execPath, [MAIN], {
    cwd: root,
    env: { PATH: process.env.PATH ?? "", ...extra },
  });
  let err = "";
  let out = "";
  child.stderr?.on("data", (d: Buffer) => {
    err += d.toString();
  });
  child.stdout?.on("data", (d: Buffer) => {
    out += d.toString();
  });
  const exit = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
  return { child, stderr: () => err, stdout: () => out, exit };
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

async function waitFor(read: () => string, needle: string, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  for (;;) {
    if (read().includes(needle)) return;
    if (Date.now() > deadline) throw new Error("timed out waiting for output");
    await new Promise((r) => setTimeout(r, 50));
  }
}

function crashRun(trigger: string): Promise<{ code: number | null; stdout: string }> {
  const metricsUrl = pathToFileURL(join(root, "build/remote/metrics-log.js")).href;
  const script = `import { createMetricsLog, installCrashHandlers } from ${JSON.stringify(metricsUrl)}; installCrashHandlers(process, createMetricsLog(), (c) => { process.exitCode = c; process.stdout.write("", () => process.exit(c)); }); ${trigger}`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
    cwd: root,
    env: { PATH: process.env.PATH ?? "" },
  });
  let out = "";
  child.stdout?.on("data", (d: Buffer) => {
    out += d.toString();
  });
  return new Promise((resolve) => {
    child.on("exit", (code) => resolve({ code, stdout: out }));
  });
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

  it("emits one start line and no metrics for healthz", async () => {
    const run = launch({ KPM_HTTP_PORT: "0" });
    const m = await waitForMatch(run, /listening on 127\.0\.0\.1:(\d+)/, 10_000);
    const port = Number(m[1]);
    await waitFor(run.stdout, '"ev":"start"', 10_000);

    const health = await rawRequest(port, { method: "GET", path: "/healthz" });
    expect(health.status).toBe(200);
    await new Promise((r) => setTimeout(r, 100));

    const lines = run.stdout().split("\n").filter((l) => l !== "");
    expect(lines).toEqual([JSON.stringify({ ev: "start", version: VERSION })]);

    run.child.kill("SIGTERM");
    expect(await run.exit).toBe(0);
  });

  it("invalid rate env exits 1 with item name only", async () => {
    const run = launch({ KPM_RATE_MAX_CONCURRENT: "abc" });
    expect(await run.exit).toBe(1);
    expect(run.stderr()).toContain("KPM_RATE_MAX_CONCURRENT");
    expect(run.stderr()).not.toContain("abc");
  });

  it("invalid budget env exits 1 with item name only", async () => {
    const run = launch({ KPM_BUDGET_NEMC_LIST: "abc-sentinel" });
    expect(await run.exit).toBe(1);
    expect(run.stderr()).toContain("KPM_BUDGET_NEMC_LIST");
    expect(run.stderr()).not.toContain("abc-sentinel");
  });

  it("invalid alert ratio exits 1", async () => {
    const run = launch({ KPM_ALERT_RATIO: "9.9" });
    expect(await run.exit).toBe(1);
    expect(run.stderr()).toContain("KPM_ALERT_RATIO");
    expect(run.stderr()).not.toContain("9.9");
  });

  it.each([
    ["uncaughtException", "setTimeout(() => { throw new TypeError('sentinel-crash-msg'); }, 0);", "TypeError"],
    ["unhandledRejection", "Promise.reject(new RangeError('sentinel-crash-msg'));", "RangeError"],
  ])("crash on %s logs name only and exits 1", async (_event, trigger, name) => {
    const r = await crashRun(trigger);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe(`{"ev":"crash","kind":"${name}"}\n`);
  });
});
