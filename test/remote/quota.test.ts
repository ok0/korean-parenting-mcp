import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SPECS } from "../../src/clients/data-go-kr-specs.js";
import { dataGoKrCacheKey } from "../../src/clients/data-go-kr.js";
import { TtlCache } from "../../src/core/cache.js";
import { loadConfig } from "../../src/core/config.js";
import { createDefaultContext } from "../../src/core/context.js";
import { runTool } from "../../src/core/pipeline.js";
import { buildRemoteDeps } from "../../src/remote/app.js";
import { createMetricsLog, createRemoteLogger, QUOTA_KEYS } from "../../src/remote/metrics-log.js";
import { loadRemoteConfig } from "../../src/remote/remote-config.js";
import { findNightPediatricTool } from "../../src/tools/find-night-pediatric.js";
import { createNemcMock, TEST_KEY } from "../helpers/nemc-mock.js";
import { mcpHeaders, rawRequest, startRemote, type StartedRemote } from "../helpers/remote-server.js";

const FIXED = { now: () => new Date("2026-10-28T21:30:00+09:00") };
const HOOK = "https://hook.example/secret-path-123";
const headers: Record<string, string> = {
  ...mcpHeaders,
  "mcp-protocol-version": "2025-11-25",
  origin: "https://claude.ai",
};

const servers: StartedRemote[] = [];

afterEach(async () => {
  for (const s of servers.splice(0)) await s.close();
});

function call(id: number, name: string, args: Record<string, unknown>): string {
  return JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
}

async function post(srv: StartedRemote, id: number, name: string, args: Record<string, unknown>) {
  const r = await rawRequest(srv.port, { method: "POST", path: "/mcp", headers, body: call(id, name, args) });
  const body = JSON.parse(r.body) as { result: { isError?: boolean; content: { text: string }[] } };
  return { isError: body.result.isError, text: body.result.content.map((c) => c.text).join("\n") };
}

async function waitFor(cond: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("waitFor timeout");
    await new Promise((r) => setTimeout(r, 20));
  }
}

const parseLines = (lines: string[]): Record<string, unknown>[] =>
  lines.map((l) => JSON.parse(l) as Record<string, unknown>);

describe("remote quota wiring", () => {
  it("remote context wires guard, stale cache; local does not", () => {
    const deps = buildRemoteDeps(loadRemoteConfig({}));
    expect(deps.baseCtx.upstream).toBeDefined();
    expect(deps.baseCtx.cache).toBeInstanceOf(TtlCache);
    expect((deps.baseCtx.cache as TtlCache).staleRetentionMs).toBe(86_400_000);
    expect(deps.baseCtx.notices).toBeUndefined();

    const local = createDefaultContext(loadConfig({}));
    expect(local.upstream).toBeUndefined();
    expect(local.notices).toBeUndefined();
    expect((local.cache as TtlCache).staleRetentionMs).toBe(0);
  });

  it("no TTL 0 cacheable call remotely", () => {
    const deps = buildRemoteDeps(loadRemoteConfig({}));
    const guard = deps.baseCtx.upstream!;
    for (const spec of Object.values(SPECS).filter((s) => s.confirmed)) {
      expect(Math.max(spec.cacheTtlMs, guard.minTtl(dataGoKrCacheKey(spec, {})))).toBeGreaterThan(0);
    }
  });

  it("HTTP: NEMC budget exhausted blocks only NEMC", async () => {
    const lines: string[] = [];
    const mock = createNemcMock();
    const srv = await startRemote(
      {},
      { clock: FIXED, fetch: mock.fetch },
      { DATA_GO_KR_SERVICE_KEY: TEST_KEY, KPM_BUDGET_NEMC_LIST: "1", KPM_BUDGET_NEMC_MOONLIGHT: "1" },
      { metrics: createMetricsLog((l) => lines.push(l)) },
    );
    servers.push(srv);

    const first = await post(srv, 1, "find_night_pediatric", { region: "성동구" });
    expect(first.isError).toBeFalsy();
    expect(mock.count("moon")).toBe(1);
    expect(mock.count("peds")).toBe(1);

    const blocked = await post(srv, 2, "find_night_pediatric", { region: "강남구" });
    expect(blocked.isError).toBe(true);
    expect(blocked.text).toContain("DAILY_LIMIT");
    expect(blocked.text).toContain("잠시 후 재시도");
    expect(mock.count("moon")).toBe(1);
    expect(mock.count("peds")).toBe(1);

    const timeline = await post(srv, 3, "get_timeline", { birth_date: "2025-03-17" });
    expect(timeline.isError).toBeFalsy();

    await waitFor(() => parseLines(lines).filter((o) => o.ev === "quota").length >= 4);
    const quota = parseLines(lines).filter((o) => o.ev === "quota");
    for (const bucket of ["nemcList", "nemcMoonlight"]) {
      for (const level of ["near", "exhausted"]) {
        expect(quota.filter((o) => o.bucket === bucket && o.level === level)).toHaveLength(1);
      }
    }
    for (const o of quota) {
      for (const k of Object.keys(o)) expect(QUOTA_KEYS as readonly string[]).toContain(k);
    }
  });

  it("webhook: same JSON once per bucket·level·day, never delays, URL hidden", async () => {
    const rc = loadRemoteConfig({
      DATA_GO_KR_SERVICE_KEY: TEST_KEY,
      KPM_BUDGET_NEMC_LIST: "1",
      KPM_BUDGET_NEMC_MOONLIGHT: "1",
      KPM_ALERT_WEBHOOK_URL: HOOK,
    });
    const mock = createNemcMock();
    const lines: string[] = [];
    const logs: string[] = [];
    const webhookFetch = vi.fn((_url: string | URL | Request, _init?: RequestInit) => new Promise<Response>(() => {}));
    const deps = buildRemoteDeps(
      rc,
      { clock: FIXED, fetch: mock.fetch, log: createRemoteLogger(rc.secrets, (l) => logs.push(l)) },
      { metrics: createMetricsLog((l) => lines.push(l)), webhookFetch: webhookFetch as unknown as typeof fetch },
    );

    const texts: string[] = [];
    for (const region of ["성동구", "강남구", "강남구"]) {
      const t0 = Date.now();
      const res = await runTool(findNightPediatricTool, { region }, { ...deps.baseCtx, notices: [] });
      expect(Date.now() - t0).toBeLessThan(2000);
      texts.push(JSON.stringify(res));
    }
    expect(JSON.parse(texts[0]!).isError).toBeUndefined();
    expect(JSON.parse(texts[1]!).isError).toBe(true);

    expect(webhookFetch).toHaveBeenCalledTimes(4);
    const quotaLines = lines.filter((l) => (JSON.parse(l) as { ev?: string }).ev === "quota").map((l) => l.replace(/\n$/, ""));
    expect(quotaLines).toHaveLength(4);
    for (const [, init] of webhookFetch.mock.calls) {
      expect(init?.method).toBe("POST");
      expect(quotaLines).toContain(init?.body);
    }

    const counts = await deps.baseCtx.upstream!.counts(FIXED.now().getTime());
    expect(counts.nemcList).toBe(1);
    expect(counts.nemcMoonlight).toBe(1);

    for (const text of [...lines, ...logs, ...texts]) {
      expect(text).not.toContain("hook.example");
      expect(text).not.toContain("secret-path-123");
    }
    expect(rc.secrets).toContain(HOOK);
  });

  it("webhook failure is silent and never changes the result", async () => {
    const rc = loadRemoteConfig({
      DATA_GO_KR_SERVICE_KEY: TEST_KEY,
      KPM_BUDGET_NEMC_LIST: "1",
      KPM_BUDGET_NEMC_MOONLIGHT: "1",
      KPM_ALERT_WEBHOOK_URL: HOOK,
    });
    const mock = createNemcMock();
    const lines: string[] = [];
    const logs: string[] = [];
    const webhookFetch = vi.fn((_url: string | URL | Request, _init?: RequestInit) =>
      Promise.reject(new Error(`${HOOK} failed`)),
    );
    const deps = buildRemoteDeps(
      rc,
      { clock: FIXED, fetch: mock.fetch, log: createRemoteLogger(rc.secrets, (l) => logs.push(l)) },
      { metrics: createMetricsLog((l) => lines.push(l)), webhookFetch: webhookFetch as unknown as typeof fetch },
    );

    const texts: string[] = [];
    for (const region of ["성동구", "강남구", "강남구"]) {
      const res = await runTool(findNightPediatricTool, { region }, { ...deps.baseCtx, notices: [] });
      texts.push(JSON.stringify(res));
    }
    await new Promise((r) => setTimeout(r, 20));

    expect(JSON.parse(texts[0]!).isError).toBeUndefined();
    expect(JSON.parse(texts[1]!).isError).toBe(true);
    expect(webhookFetch).toHaveBeenCalledTimes(4);
    expect(logs).toHaveLength(2);
    for (const l of logs) expect(l).toContain("tool error");
    for (const text of [...lines, ...logs, ...texts]) {
      expect(text).not.toContain("hook.example");
      expect(text).not.toContain("secret-path-123");
    }
  });

  it("remote quota state is memory only", () => {
    for (const f of ["../../src/core/upstream-guard.ts", "../../src/remote/quota-alert.ts"]) {
      const text = readFileSync(new URL(f, import.meta.url), "utf8");
      expect(text).not.toMatch(/writeFile|appendFile|createWriteStream|node:fs/);
    }
  });
});
