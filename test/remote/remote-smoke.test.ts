import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { formatReport, runRemoteSmoke, SMOKE_IDS, startLocalRemote, type SmokeCheck } from "../../scripts/lib/remote-smoke.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const CLI = join(root, "build-scripts/scripts/remote-smoke.js");
const SMOKE_TEST_TIMEOUT = 60000;

function failing(checks: readonly SmokeCheck[]): string {
  return checks
    .filter((c) => !c.ok)
    .map((c) => `${c.id}: ${c.detail}`)
    .join("; ");
}

describe("remote smoke", () => {
  beforeAll(() => {
    expect(existsSync(join(root, "build/remote/main.js")), "build/remote/main.js 가 없습니다. npm run build 를 먼저 실행하세요").toBe(true);
  });

  it(
    "local remote passes every check",
    async () => {
      const r = await startLocalRemote({ root });
      try {
        const checks = await runRemoteSmoke(r.baseUrl, { expectOrigin: "reject" });
        expect(checks.map((c) => c.id)).toEqual([...SMOKE_IDS]);
        expect(checks.every((c) => c.ok), failing(checks)).toBe(true);
        expect(formatReport(checks).ok).toBe(true);
      } finally {
        await r.stop();
      }
    },
    SMOKE_TEST_TIMEOUT,
  );

  it(
    "origin leak is detected",
    async () => {
      const r = await startLocalRemote({ root, extraEnv: { KPM_ORIGIN_POLICY: "report" } });
      try {
        const rejected = await runRemoteSmoke(r.baseUrl, { expectOrigin: "reject" });
        expect(rejected.filter((c) => !c.ok).map((c) => c.id)).toEqual(["origin"]);
        expect(formatReport(rejected).ok).toBe(false);

        const allowed = await runRemoteSmoke(r.baseUrl, { expectOrigin: "allow" });
        expect(allowed.every((c) => c.ok), failing(allowed)).toBe(true);
      } finally {
        await r.stop();
      }
    },
    SMOKE_TEST_TIMEOUT,
  );

  it(
    "start failure is reported without values",
    async () => {
      await expect(startLocalRemote({ root, extraEnv: { KPM_HOST_REQUEST_LOGS: "bogus" } })).rejects.toThrow("로컬 원격 서버 시작 실패");
    },
    SMOKE_TEST_TIMEOUT,
  );

  describe.skipIf(!existsSync(CLI))("CLI", () => {
    const run = (args: string[]) =>
      spawnSync(process.execPath, [CLI, ...args], {
        env: { PATH: process.env.PATH ?? "" },
        cwd: root,
        timeout: 60000,
        encoding: "utf8",
      });

    it(
      "no args passes 6/6",
      () => {
        const res = run([]);
        expect(res.status, res.stderr).toBe(0);
        expect(res.stdout).toContain("REMOTE SMOKE PASS (6/6)");
      },
      SMOKE_TEST_TIMEOUT,
    );

    it(
      "origin policy report fails 5/6",
      () => {
        const res = run(["--set", "KPM_ORIGIN_POLICY=report"]);
        expect(res.status).toBe(1);
        expect(res.stderr).toContain("FAIL origin");
        expect(res.stderr).toContain("REMOTE SMOKE FAIL (5/6)");
      },
      SMOKE_TEST_TIMEOUT,
    );

    it(
      "secret name in --set is a usage error",
      () => {
        const res = run(["--set", "DATA_GO_KR_SERVICE_KEY=x"]);
        expect(res.status).toBe(1);
        expect(res.stderr).toContain("사용법 오류");
      },
      SMOKE_TEST_TIMEOUT,
    );

    it(
      "non-loopback http base url is a usage error",
      () => {
        const res = run(["http://example.com"]);
        expect(res.status).toBe(1);
        expect(res.stderr).toContain("사용법 오류");
      },
      SMOKE_TEST_TIMEOUT,
    );
  });
});
