import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { TtlCache } from "../../src/core/cache.js";
import type { ToolContext } from "../../src/core/context.js";
import {
  createMetricsLog,
  createRemoteLogger,
  QUOTA_KEYS,
  REQ_KEYS,
  type MetricsEvent,
} from "../../src/remote/metrics-log.js";
import { loadRemoteConfig } from "../../src/remote/remote-config.js";
import { createDgkMock } from "../helpers/dgk-mock.js";
import { TEST_KEY as DGK } from "../helpers/nemc-mock.js";
import { KG_TEST_KEY as KG } from "../helpers/kg-mock.js";
import { SK_TEST_KEY as SK } from "../helpers/sk-mock.js";
import { mcpHeaders, rawRequest, startRemote, type StartedRemote } from "../helpers/remote-server.js";

const LAW = "Lw+id/=7 Q&z9-m18";
const ENV = { DATA_GO_KR_SERVICE_KEY: DGK, KINDERGARTEN_API_KEY: KG, LAW_OC: LAW, SAFETYKOREA_AUTH_KEY: SK };
const forms = (v: string): string[] => [v, encodeURIComponent(v), new URLSearchParams({ k: v }).toString().slice(2)];
const KEYS = [DGK, KG, LAW, SK].flatMap(forms);

const IP = "203.0.113.77";
const UA = "SentinelUA/9.9";
const ARG_SENTINELS = ["센티넬약품명", "센티넬구역", "2026-05-28", "2027-03-15", "2025-03-17", "센티넬내부오류"];
const UNKNOWN_TOOL = "fx_sentinel_tool";
const FIXED = { now: () => new Date("2026-10-28T21:30:00+09:00") };

const metrics: string[] = [];
const logs: string[] = [];
const std: string[] = [];
const http: string[] = [];
const hooks: string[] = [];
let toolsListBody = "";

const push = (arr: string[]) => (line: string): void => {
  arr.push(line);
};

const headers: Record<string, string> = {
  ...mcpHeaders,
  "mcp-protocol-version": "2025-11-25",
  "x-forwarded-for": IP,
  "user-agent": UA,
  origin: "https://claude.ai",
};

function call(id: number, name: string, args: Record<string, unknown>) {
  return JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
}

async function waitFor(cond: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("waitFor timeout");
    await new Promise((r) => setTimeout(r, 20));
  }
}

function collectPropertyKeys(node: unknown, out: string[]): void {
  if (Array.isArray(node)) {
    for (const v of node) collectPropertyKeys(v, out);
    return;
  }
  if (node !== null && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if (obj.properties !== null && typeof obj.properties === "object") {
      out.push(...Object.keys(obj.properties as Record<string, unknown>));
    }
    for (const v of Object.values(obj)) collectPropertyKeys(v, out);
  }
}

const started: StartedRemote[] = [];
const spies: ReturnType<typeof vi.spyOn>[] = [];

async function send(srv: StartedRemote, body: string): Promise<void> {
  const r = await rawRequest(srv.port, { method: "POST", path: "/mcp", headers, body });
  http.push(JSON.stringify({ status: r.status, headers: r.headers, body: r.body }));
  if (body.includes('"tools/list"')) toolsListBody = r.body;
}

beforeAll(async () => {
  const capture = (chunk: unknown): boolean => {
    std.push(String(chunk));
    return true;
  };
  spies.push(vi.spyOn(process.stderr, "write").mockImplementation(capture as never));
  spies.push(vi.spyOn(process.stdout, "write").mockImplementation(capture as never));
  const secrets = loadRemoteConfig(ENV).secrets;
  const cfg = { trustProxy: "xff" as const };

  const s1 = await startRemote(
    cfg,
    {
      clock: FIXED,
      fetch: async () => new Response("err", { status: 503 }),
      cache: new TtlCache(),
      log: createRemoteLogger(secrets, push(logs)),
    } as Partial<ToolContext>,
    ENV,
    { metrics: createMetricsLog(push(metrics)) },
  );
  started.push(s1);
  await send(s1, call(1, "find_daycare", { birth_date: "2026-05-28", due_date: "2027-03-15" }));
  await send(s1, call(2, "find_night_pediatric", { region: "센티넬구역", limit: "abc" }));
  await send(s1, call(3, "check_pregnancy_drug", { drug_name: "센티넬약품명" }));
  await send(s1, call(4, UNKNOWN_TOOL, { q: "센티넬구역" }));
  await send(
    s1,
    JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/list" }),
  );

  const s2 = await startRemote(
    cfg,
    {
      clock: {
        now() {
          throw new Error("센티넬내부오류 2025-03-17");
        },
      },
      log: createRemoteLogger(secrets, push(logs)),
    } as Partial<ToolContext>,
    ENV,
    { metrics: createMetricsLog(push(metrics)), clock: FIXED },
  );
  started.push(s2);
  await send(s2, call(6, "get_timeline", { birth_date: "2025-03-17" }));

  const s3 = await startRemote(
    cfg,
    {
      clock: FIXED,
      fetch: createDgkMock().fetch,
      log: createRemoteLogger(secrets, push(logs)),
    } as Partial<ToolContext>,
    { ...ENV, KPM_BUDGET_DUR: "1", KPM_ALERT_WEBHOOK_URL: "https://hook.example/audit-sentinel" },
    {
      metrics: createMetricsLog(push(metrics)),
      webhookFetch: async (_u, init) => {
        hooks.push(String(init?.body));
        return new Response("ok");
      },
    },
  );
  started.push(s3);
  await send(s3, call(7, "check_pregnancy_drug", { drug_name: "센티넬약품명" }));
  await send(s3, call(8, "check_pregnancy_drug", { drug_name: "센티넬약품명B" }));

  await waitFor(
    () =>
      metrics.filter((l) => l.includes('"ev":"req"')).length >= 8 &&
      metrics.filter((l) => l.includes('"ev":"quota"')).length >= 2 &&
      hooks.length >= 2,
  );
  for (const spy of spies) spy.mockRestore();
});

afterAll(async () => {
  for (const spy of spies) spy.mockRestore();
  for (const srv of started) await srv.close();
});

describe("sentinel audit", () => {
  it("no keys, args or IP anywhere", () => {
    for (const text of [...metrics, ...logs, ...std, ...http, ...hooks]) {
      for (const k of KEYS) expect(text.includes(k), k).toBe(false);
      expect(text.includes(IP), "IP").toBe(false);
      expect(text.includes(UA), "UA").toBe(false);
    }
  });

  it("metrics, logs and stdio hold no arg sentinels", () => {
    for (const text of [...metrics, ...logs, ...std, ...hooks]) {
      for (const s of [...ARG_SENTINELS, UNKNOWN_TOOL]) expect(text.includes(s), s).toBe(false);
    }
  });

  it("metrics lines are whitelisted", () => {
    const parsed = metrics.map((l) => JSON.parse(l) as Record<string, unknown>);
    for (const obj of parsed) {
      const allowed: readonly string[] = obj.ev === "quota" ? QUOTA_KEYS : REQ_KEYS;
      for (const k of Object.keys(obj)) expect(allowed).toContain(k);
    }
    const kinds = parsed.map((o) => o.kind);
    expect(kinds).toContain("BAD_INPUT");
    expect(kinds).toContain("UPSTREAM");
    expect(kinds).toContain("INTERNAL");
    expect(parsed.some((o) => o.tool === "unknown")).toBe(true);
    expect(parsed.some((o) => o.ev === "quota" && o.level === "near")).toBe(true);
    expect(parsed.some((o) => o.ev === "quota" && o.level === "exhausted")).toBe(true);
  });

  it("webhook URL never logged", () => {
    for (const text of [...metrics, ...logs, ...std, ...http]) {
      expect(text.includes("hook.example"), "hook").toBe(false);
    }
    expect(hooks.length).toBeGreaterThanOrEqual(2);
    for (const h of hooks) {
      const obj = JSON.parse(h) as Record<string, unknown>;
      for (const k of Object.keys(obj)) expect(QUOTA_KEYS as readonly string[]).toContain(k);
    }
  });

  it("injected extra keys are not written", () => {
    const lines: string[] = [];
    createMetricsLog(push(lines)).emit({
      ev: "req",
      rpc: "tools/call",
      tool: "get_timeline",
      http: 200,
      outcome: "ok",
      ms: 1,
      origin: "none",
      ip: IP,
      args: { a: "센티넬구역" },
      key: SK,
    } as unknown as MetricsEvent);
    expect(lines).toHaveLength(1);
    const obj = JSON.parse(lines[0] as string) as Record<string, unknown>;
    expect(obj).not.toHaveProperty("ip");
    expect(obj).not.toHaveProperty("args");
    expect(obj).not.toHaveProperty("key");
  });

  it("remote tools/list has no key fields", () => {
    const body = JSON.parse(toolsListBody) as { result: { tools: { inputSchema?: unknown }[] } };
    const names: string[] = [];
    for (const t of body.result.tools) collectPropertyKeys(t.inputSchema, names);
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) expect(n).not.toMatch(/key$|^oc$|token|secret|auth/i);
  });

  it("SAFETYKOREA removed from remote base", () => {
    const rc = loadRemoteConfig(ENV);
    expect(rc.base.keys.SAFETYKOREA).toBeUndefined();
    expect(rc.secrets).toContain(SK);
  });
});
