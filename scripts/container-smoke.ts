import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { formatReport, runRemoteSmoke, SMOKE_PLACEHOLDER_ENV, type SmokeCheck } from "./lib/remote-smoke.js";
import { isMainModule } from "./lib/script-io.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const IMAGE = "korean-parenting-mcp:smoke";
const HEALTH_TIMEOUT_MS = 30000;
const HEALTH_INTERVAL_MS = 500;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function dockerAvailable(): boolean {
  const info = spawnSync("docker", ["info"], { stdio: "ignore" });
  return !info.error && info.status === 0;
}

async function waitHealthy(base: string): Promise<boolean> {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const ok = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(2000) }).then(
      (res) => {
        void res.body?.cancel().catch(() => undefined);
        return res.status === 200;
      },
      () => false,
    );
    if (ok) return true;
    await sleep(HEALTH_INTERVAL_MS);
  }
  return false;
}

function publishedPort(id: string): number | undefined {
  const out = spawnSync("docker", ["port", id, "8080/tcp"], { encoding: "utf8" });
  const match = /127\.0\.0\.1:(\d+)/.exec(out.stdout ?? "");
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

function userCheck(id: string): SmokeCheck {
  const out = spawnSync("docker", ["exec", id, "id", "-u"], { encoding: "utf8" });
  const uid = (out.stdout ?? "").trim();
  const ok = !out.error && out.status === 0 && uid !== "" && uid !== "0";
  return { id: "user", ok, detail: `uid ${uid || "unknown"}` };
}

async function runContainer(id: string): Promise<SmokeCheck[] | "no-port" | "unhealthy"> {
  const port = publishedPort(id);
  if (port === undefined) return "no-port";
  const base = `http://127.0.0.1:${port}`;
  if (!(await waitHealthy(base))) return "unhealthy";
  const checks = await runRemoteSmoke(base, { expectOrigin: "reject" });
  checks.push(userCheck(id));
  return checks;
}

export async function main(): Promise<number> {
  if (!dockerAvailable()) {
    process.stdout.write("CONTAINER SMOKE SKIP: docker를 사용할 수 없습니다\n");
    return 0;
  }

  const build = spawnSync("docker", ["build", "-t", IMAGE, "."], { cwd: root, stdio: "inherit" });
  if (build.error || build.status !== 0) {
    process.stdout.write("CONTAINER SMOKE FAIL: build\n");
    return 1;
  }

  const envArgs = Object.entries(SMOKE_PLACEHOLDER_ENV).flatMap(([name, value]) => ["-e", `${name}=${value}`]);
  const run = spawnSync("docker", ["run", "-d", "--rm", "-p", "127.0.0.1::8080", ...envArgs, IMAGE], {
    cwd: root,
    encoding: "utf8",
  });
  const id = (run.stdout ?? "").trim();
  if (run.error || run.status !== 0 || id === "") {
    process.stdout.write("CONTAINER SMOKE FAIL: run\n");
    return 1;
  }

  try {
    const result = await runContainer(id);
    if (result === "no-port") {
      process.stdout.write("CONTAINER SMOKE FAIL: port\n");
      return 1;
    }
    if (result === "unhealthy") {
      process.stdout.write("CONTAINER SMOKE FAIL: healthz 대기 시간 초과\n");
      return 1;
    }
    const { lines, ok } = formatReport(result);
    for (const line of lines) process.stdout.write(`${line}\n`);
    const passed = result.filter((c) => c.ok).length;
    if (ok) {
      process.stdout.write(`CONTAINER SMOKE PASS (${passed}/${result.length})\n`);
      return 0;
    }
    process.stdout.write(`CONTAINER SMOKE FAIL (${passed}/${result.length})\n`);
    return 1;
  } finally {
    spawnSync("docker", ["rm", "-f", id], { stdio: "ignore" });
  }
}

if (isMainModule(import.meta.url)) {
  void main().then((c) => {
    process.exitCode = c;
  });
}
