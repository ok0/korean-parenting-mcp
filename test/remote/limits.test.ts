import { request } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { TtlCache } from "../../src/core/cache.js";
import { createMetricsLog, REQ_KEYS } from "../../src/remote/metrics-log.js";
import type { RemoteConfig } from "../../src/remote/remote-config.js";
import { initBody, mcpHeaders, rawRequest, startRemote, type StartedRemote } from "../helpers/remote-server.js";

const SECURITY = { "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" };

const blockedFetch: typeof fetch = async () => {
  throw new Error("network disabled in tests");
};

const listBody = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });

function callBody(name: string, args: Record<string, unknown>, id = 3): string {
  return JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
}

function rate(perClientPerMin: number, sharedPoolPerMin = 100, globalPerMin = 100, maxConcurrent = 10) {
  return { perClientPerMin, sharedPoolPerMin, globalPerMin, maxConcurrent };
}

function gated() {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const fetchImpl: typeof fetch = async () => {
    calls++;
    await gate;
    return new Response("err", { status: 503 });
  };
  return { fetch: fetchImpl, open: () => release(), count: () => calls };
}

interface Harness {
  srv: StartedRemote;
  port: number;
  clock: { t: number; now(): Date };
  lines: string[];
}

const opened: StartedRemote[] = [];

async function start(
  rcOver: Partial<RemoteConfig> = {},
  env: Record<string, string> = {},
  fetchImpl: typeof fetch = blockedFetch,
): Promise<Harness> {
  const clock = { t: Date.parse("2026-10-28T12:00:00Z"), now() { return new Date(this.t); } };
  const lines: string[] = [];
  const srv = await startRemote(
    rcOver,
    { clock, fetch: fetchImpl, cache: new TtlCache() },
    env,
    { clock, metrics: createMetricsLog((l) => lines.push(l)) },
  );
  opened.push(srv);
  return { srv, port: srv.port, clock, lines };
}

afterEach(async () => {
  while (opened.length) await opened.pop()!.close();
});

async function waitFor(pred: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

function post(port: number, xff?: string, body = listBody, extra: Record<string, string> = {}) {
  return rawRequest(port, {
    method: "POST",
    path: "/mcp",
    headers: { ...mcpHeaders, ...(xff !== undefined ? { "x-forwarded-for": xff } : {}), ...extra },
    body,
  });
}

function expectSecurity(headers: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(SECURITY)) expect(headers[k], k).toBe(v);
}

function parsed(lines: string[]): Record<string, unknown>[] {
  return lines.map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe("remote limits", () => {
  it("per-client limit with retry-after (xff trusted)", async () => {
    const h = await start({ trustProxy: "xff", rate: rate(2) });
    expect((await post(h.port, "198.51.100.1")).status).toBe(200);
    expect((await post(h.port, "198.51.100.1")).status).toBe(200);

    const limited = await post(h.port, "198.51.100.1");
    expect(limited.status).toBe(429);
    expect(limited.headers["retry-after"]).toBe("60");
    expect(String(limited.headers["content-type"])).toContain("application/json");
    const err = (JSON.parse(limited.body) as { error: { code: number; message: string } }).error;
    expect(err.code).toBe(-32029);
    expect(err.message).toContain("60초");
    expectSecurity(limited.headers);
    expect(limited.body).not.toContain("198.51.100.1");
    expect(JSON.stringify(limited.headers)).not.toContain("198.51.100.1");

    expect((await post(h.port, "198.51.100.2")).status).toBe(200);

    h.clock.t += 60_000;
    expect((await post(h.port, "198.51.100.1")).status).toBe(200);
  });

  it("trustProxy none ignores x-forwarded-for", async () => {
    const h = await start({ rate: rate(2) });
    expect((await post(h.port, "1.1.1.1")).status).toBe(200);
    expect((await post(h.port, "2.2.2.2")).status).toBe(200);
    expect((await post(h.port, "3.3.3.3")).status).toBe(429);
  });

  it("xff only from trusted proxy", async () => {
    const h = await start({ trustProxy: "xff", trustedProxyCidrs: ["10.0.0.0/8"], rate: rate(2) });
    expect((await post(h.port, "1.1.1.1")).status).toBe(200);
    expect((await post(h.port, "2.2.2.2")).status).toBe(200);
    expect((await post(h.port, "3.3.3.3")).status).toBe(429);
  });

  it("shared egress pool", async () => {
    const cfg = { trustProxy: "xff" as const, rate: rate(1, 3, 100, 10) };
    const h = await start(cfg);
    expect((await post(h.port, "160.79.104.10")).status).toBe(200);
    expect((await post(h.port, "160.79.105.20")).status).toBe(200);
    expect((await post(h.port, "160.79.111.200")).status).toBe(200);
    expect((await post(h.port, "160.79.106.1")).status).toBe(429);
    expect((await post(h.port, "198.51.100.7")).status).toBe(200);

    await waitFor(() => parsed(h.lines).length >= 5);
    const reqs = parsed(h.lines);
    for (const r of reqs) expect(["shared", "direct"]).toContain(r.pool);
    expect(reqs.filter((r) => r.pool === "shared")).toHaveLength(4);
    expect(reqs.filter((r) => r.pool === "direct")).toHaveLength(1);

    const h2 = await start(cfg);
    expect((await post(h2.port, "198.51.100.7")).status).toBe(200);
    expect((await post(h2.port, "198.51.100.7")).status).toBe(429);
    expect((await post(h2.port, "160.79.104.10")).status).toBe(200);
  });

  it("global limit", async () => {
    const h = await start({ trustProxy: "xff", rate: rate(100, 100, 3, 10) });
    expect((await post(h.port, "198.51.100.11")).status).toBe(200);
    expect((await post(h.port, "198.51.100.12")).status).toBe(200);
    expect((await post(h.port, "198.51.100.13")).status).toBe(200);
    expect((await post(h.port, "198.51.100.14")).status).toBe(429);
  });

  it("concurrency limit and slot release", async () => {
    const env = { DATA_GO_KR_SERVICE_KEY: "fake-dgk-key-0001" };
    const g = gated();
    const h = await start({ trustProxy: "xff", rate: rate(100, 100, 100, 2) }, env, g.fetch);
    const a = post(h.port, undefined, callBody("check_pregnancy_drug", { drug_name: "아세트아미노펜" }, 1));
    const b = post(h.port, undefined, callBody("check_pregnancy_drug", { drug_name: "이부프로펜" }, 2));
    await waitFor(() => g.count() >= 2);

    const busy = await post(h.port);
    expect(busy.status).toBe(429);
    expect(busy.headers["retry-after"]).toBe("1");

    g.open();
    expect((await a).status).toBe(200);
    expect((await b).status).toBe(200);
    expect((await post(h.port)).status).toBe(200);

    const g2 = gated();
    const h2 = await start({ trustProxy: "xff", rate: rate(100, 100, 100, 1) }, env, g2.fetch);
    const req = request({
      host: "127.0.0.1",
      port: h2.port,
      method: "POST",
      path: "/mcp",
      headers: { host: `127.0.0.1:${h2.port}`, ...mcpHeaders },
    });
    req.on("error", () => {});
    req.end(callBody("check_pregnancy_drug", { drug_name: "아세트아미노펜" }, 3));
    await waitFor(() => g2.count() >= 1);
    req.destroy();
    await waitFor(() => h2.lines.some((l) => l.includes('"rpc":"tools/call"')));
    expect((await post(h2.port)).status).toBe(200);
    g2.open();
  });

  it("body limit and parse errors", async () => {
    const h = await start({ rate: rate(100), maxBodyBytes: 1024 });

    const big = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { pad: "SENTINELPAD".repeat(200) } });
    const chunked = await rawRequest(h.port, { method: "POST", path: "/mcp", headers: mcpHeaders, body: big });
    expect(chunked.status).toBe(413);
    expect(chunked.body).toBe("payload too large");
    expect(chunked.body).not.toContain("SENTINELPAD");
    expectSecurity(chunked.headers);

    const declared = await rawRequest(h.port, {
      method: "POST",
      path: "/mcp",
      headers: { ...mcpHeaders, "content-length": "100000" },
      body: "",
      untilHeaders: true,
    });
    expect(declared.status).toBe(413);
    declared.destroy();

    const bad = await post(h.port, undefined, "{not json SENTINELX");
    expect(bad.status).toBe(400);
    expect(String(bad.headers["content-type"])).toMatch(/^application\/json/);
    expect((JSON.parse(bad.body) as { error: { code: number } }).error.code).toBe(-32700);
    expect(bad.body).not.toContain("SENTINELX");
    expectSecurity(bad.headers);

    const ok = await rawRequest(h.port, { method: "POST", path: "/mcp", headers: mcpHeaders, body: initBody() });
    expect(ok.status).toBe(200);

    await waitFor(() => parsed(h.lines).filter((p) => p.reason === "body").length >= 2 && parsed(h.lines).some((p) => p.reason === "parse"));
    const body = parsed(h.lines).filter((p) => p.reason === "body");
    expect(body).toHaveLength(2);
    for (const p of body) expect(p.outcome).toBe("rejected");
    expect(parsed(h.lines).some((p) => p.reason === "parse" && p.outcome === "rejected")).toBe(true);
  });

  it("daily request cap (AC4)", async () => {
    const h = await start({ dailyRequestCap: 2 });
    expect((await post(h.port)).status).toBe(200);
    expect((await post(h.port)).status).toBe(200);

    const capped = await post(h.port);
    expect(capped.status).toBe(429);
    expect(Number(capped.headers["retry-after"])).toBeGreaterThan(0);
    expect(String(capped.headers["retry-after"])).toMatch(/^\d+$/);
    expect((JSON.parse(capped.body) as { error: { message: string } }).error.message).toContain("오늘 원격 사용량 한도");
    expect(capped.body).not.toContain("127.0.0.1");
    expect(JSON.stringify(capped.headers)).not.toContain("127.0.0.1");
    expect(capped.body).not.toContain("tools/list");

    await waitFor(() => parsed(h.lines).some((p) => p.outcome === "rate_limited"));
    for (const line of h.lines) {
      const obj = JSON.parse(line) as Record<string, unknown>;
      for (const k of Object.keys(obj)) expect(REQ_KEYS).toContain(k);
    }
    expect(parsed(h.lines).find((p) => p.outcome === "rate_limited")).toBeDefined();

    h.clock.t += 4 * 3_600_000;
    expect((await post(h.port)).status).toBe(200);
  });

  it("xff client index selects key (AC8)", async () => {
    const rate8 = { perClientPerMin: 1, sharedPoolPerMin: 1000, globalPerMin: 1000, maxConcurrent: 16 };
    const h = await start({ trustProxy: "xff", xffClientIndexFromRight: 2, rate: rate8 });
    expect((await post(h.port, "198.51.100.7, 203.0.113.5")).status).toBe(200);
    expect((await post(h.port, "198.51.100.8, 203.0.113.5")).status).toBe(200);
    expect((await post(h.port, "160.79.104.10, 203.0.113.5")).status).toBe(200);
    await waitFor(() => h.lines.length >= 3);
    expect(parsed(h.lines)[2]?.pool).toBe("shared");

    const h1 = await start({ trustProxy: "xff", xffClientIndexFromRight: 1, rate: rate8 });
    expect((await post(h1.port, "198.51.100.7, 203.0.113.5")).status).toBe(200);
    expect((await post(h1.port, "198.51.100.8, 203.0.113.5")).status).toBe(429);
    expect((await post(h1.port, "160.79.104.10, 203.0.113.5")).status).toBe(429);
    await waitFor(() => h1.lines.length >= 3);
    expect(parsed(h1.lines)[2]?.pool).toBe("direct");

    const h3 = await start({ trustProxy: "xff", xffClientIndexFromRight: 3, rate: rate8 });
    expect((await post(h3.port, "198.51.100.7, 203.0.113.5")).status).toBe(200);
    expect((await post(h3.port, "198.51.100.8, 203.0.113.6")).status).toBe(429);
  });

  it("metrics: one req line per request, none for healthz", async () => {
    const h = await start();
    const parsedLines = () => parsed(h.lines);

    expect((await rawRequest(h.port, { method: "GET", path: "/healthz" })).status).toBe(200);
    expect((await rawRequest(h.port, { method: "HEAD", path: "/healthz" })).status).toBe(200);
    await new Promise((r) => setTimeout(r, 100));
    expect(h.lines).toHaveLength(0);

    const hostBad = await post(h.port, undefined, listBody, { host: "evil.example" });
    expect(hostBad.status).toBe(403);
    await waitFor(() => parsedLines().some((p) => p.reason === "host"));
    expect(parsedLines().find((p) => p.reason === "host")).toMatchObject({ outcome: "rejected", reason: "host", http: 403 });

    const init = await rawRequest(h.port, {
      method: "POST",
      path: "/mcp",
      headers: { ...mcpHeaders, "mcp-protocol-version": "2025-11-25", origin: "https://claude.ai" },
      body: initBody(),
    });
    expect(init.status).toBe(200);
    await waitFor(() => parsedLines().some((p) => p.rpc === "initialize"));
    expect(parsedLines().find((p) => p.rpc === "initialize")).toMatchObject({
      rpc: "initialize",
      proto: "2025-11-25",
      origin: "claude",
      outcome: "ok",
    });

    await post(h.port, undefined, callBody("fx_sentinel_tool", { q: "x" }, 4));
    await waitFor(() => parsedLines().some((p) => p.tool === "unknown"));
    expect(parsedLines().find((p) => p.tool === "unknown")).toMatchObject({
      tool: "unknown",
      outcome: "tool_error",
      kind: "BAD_INPUT",
    });

    await post(h.port, undefined, callBody("check_recall", {}, 5));
    await waitFor(() => parsedLines().some((p) => p.tool === "check_recall"));
    expect(parsedLines().find((p) => p.tool === "check_recall")).toMatchObject({ tool: "check_recall", outcome: "ok" });

    const limited = await start({ trustProxy: "xff", rate: rate(1) });
    expect((await post(limited.port, "198.51.100.9")).status).toBe(200);
    expect((await post(limited.port, "198.51.100.9")).status).toBe(429);
    await waitFor(() => parsed(limited.lines).some((p) => p.outcome === "rate_limited"));

    for (const line of [...h.lines, ...limited.lines]) {
      const obj = JSON.parse(line) as Record<string, unknown>;
      for (const k of Object.keys(obj)) expect(REQ_KEYS).toContain(k);
    }
  });
});
