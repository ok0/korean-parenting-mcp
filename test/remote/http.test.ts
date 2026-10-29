import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import { TtlCache } from "../../src/core/cache.js";
import type { ToolContext } from "../../src/core/context.js";
import { allTools } from "../../src/tools/registry.js";
import { REMOTE_EXCLUDED_HEADING, remoteTools } from "../../src/remote/allowlist.js";
import { initBody, mcpHeaders, rawRequest, startRemote, type StartedRemote } from "../helpers/remote-server.js";

const TOKEN = "t".repeat(40);
const SECURITY = { "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" };

const blockedFetch: typeof fetch = async () => {
  throw new Error("network disabled in tests");
};

function ctxOver(): Partial<ToolContext> {
  return {
    clock: { now: () => new Date("2026-10-28T21:30:00+09:00") },
    fetch: blockedFetch,
    cache: new TtlCache(),
  };
}

const opened: StartedRemote[] = [];
async function start(rcOver = {}, env: Record<string, string> = {}): Promise<StartedRemote> {
  const srv = await startRemote(rcOver, ctxOver(), env);
  opened.push(srv);
  return srv;
}

afterEach(async () => {
  while (opened.length) await opened.pop()!.close();
});

function textOf(res: object): string {
  return (res as { content: { type: string; text: string }[] }).content[0]!.text;
}

function expectSecurity(headers: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(SECURITY)) expect(headers[k], k).toBe(v);
}

describe("remote http", () => {
  it("sdk client over http", async () => {
    const srv = await start();
    const client = new Client({ name: "t", version: "0" });
    await client.connect(new StreamableHTTPClientTransport(srv.url));

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(remoteTools(allTools).map((t) => t.name));
    expect(tools.map((t) => t.name)).not.toContain("check_recall");
    expect(client.getInstructions()).toContain(REMOTE_EXCLUDED_HEADING);

    const tl = await client.callTool({
      name: "get_timeline",
      arguments: { birth_date: "2026-01-31", reference_date: "2026-02-01" },
    });
    expect(tl.isError).toBeFalsy();
    expect(textOf(tl).length).toBeGreaterThan(0);

    const recall = await client.callTool({ name: "check_recall", arguments: {} });
    expect(recall.isError).toBeFalsy();
    expect(textOf(recall)).toContain("https://www.safetykorea.kr");

    const bad = await client.callTool({ name: "no_such_tool", arguments: {} });
    expect(bad.isError).toBe(true);
    expect(textOf(bad)).toContain("알 수 없는 도구");

    await client.close();
  });

  it("boundary", async () => {
    const srv = await start();
    const port = srv.port;
    const post = (headers: Record<string, string> = {}) =>
      rawRequest(port, { method: "POST", path: "/mcp", headers: { ...mcpHeaders, ...headers }, body: initBody() });

    const hostBad = await post({ host: "evil.example" });
    expect(hostBad.status).toBe(403);
    expect(hostBad.body).not.toContain("evil.example");
    expectSecurity(hostBad.headers);

    const originBad = await post({ origin: "https://evil.example" });
    expect(originBad.status).toBe(403);
    expect(originBad.body).not.toContain("evil.example");
    expectSecurity(originBad.headers);

    const noOrigin = await post();
    expect(noOrigin.status).toBe(200);
    expectSecurity(noOrigin.headers);

    const query = await rawRequest(port, { method: "POST", path: "/mcp?x=1", headers: mcpHeaders, body: initBody() });
    expect(query.status).toBe(400);
    expectSecurity(query.headers);

    for (const path of ["/nope", "/privacy/x", "/index.html"]) {
      const r = await rawRequest(port, { method: "GET", path });
      expect(r.status, path).toBe(404);
      expectSecurity(r.headers);
    }

    const health = await rawRequest(port, { method: "GET", path: "/healthz" });
    expect(health.status).toBe(200);
    expect(health.body).toBe("ok");
    expectSecurity(health.headers);

    const del = await rawRequest(port, { method: "DELETE", path: "/mcp" });
    expect(del.status).toBe(405);
    expect(del.headers.allow).toBeDefined();
    expectSecurity(del.headers);

    const reportSrv = await start({ originPolicy: "report" });
    const reported = await rawRequest(reportSrv.port, {
      method: "POST",
      path: "/mcp",
      headers: { ...mcpHeaders, origin: "https://evil.example" },
      body: initBody(),
    });
    expect(reported.status).toBe(200);
  });

  it("get sse", async () => {
    const srv = await start();
    const sse = await rawRequest(srv.port, {
      method: "GET",
      path: "/mcp",
      headers: { accept: "text/event-stream" },
      untilHeaders: true,
    });
    expect(sse.status).toBe(200);
    expect(String(sse.headers["content-type"])).toContain("text/event-stream");
    expectSecurity(sse.headers);
    sse.destroy();

    const noAccept = await rawRequest(srv.port, { method: "GET", path: "/mcp" });
    expect(noAccept.status).toBe(405);

    const off = await start({ getMode: "405" });
    const offRes = await rawRequest(off.port, { method: "GET", path: "/mcp", headers: { accept: "text/event-stream" } });
    expect(offRes.status).toBe(405);
    expect(offRes.headers.allow).toBe("POST");

    const capped = await start({ sseMaxStreams: 1 });
    const first = await rawRequest(capped.port, {
      method: "GET",
      path: "/mcp",
      headers: { accept: "text/event-stream" },
      untilHeaders: true,
    });
    expect(first.status).toBe(200);
    const second = await rawRequest(capped.port, {
      method: "GET",
      path: "/mcp",
      headers: { accept: "text/event-stream" },
      untilHeaders: true,
    });
    expect(second.status).toBe(503);
    expect(second.headers["retry-after"]).toBe("30");
    second.destroy();
    first.destroy();

    const short = await start({ sseMaxMs: 200 });
    const t0 = Date.now();
    const ended = await rawRequest(short.port, { method: "GET", path: "/mcp", headers: { accept: "text/event-stream" } });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(ended.status).toBe(200);
    expect(short.handler.openStreams).toBe(0);
  });

  it("bearer", async () => {
    const srv = await start({ bearerToken: TOKEN });
    const send = (headers: Record<string, string>) =>
      rawRequest(srv.port, { method: "POST", path: "/mcp", headers: { ...mcpHeaders, ...headers }, body: initBody() });

    const none = await send({});
    expect(none.status).toBe(401);
    expect(none.headers["www-authenticate"]).toBe("Bearer");

    const wrong = await send({ authorization: "Bearer wrong" });
    expect(wrong.status).toBe(401);
    expect(wrong.headers["www-authenticate"]).toBe("Bearer");

    const ok = await send({ authorization: `Bearer ${TOKEN}` });
    expect(ok.status).toBe(200);

    for (const r of [none, wrong, ok]) {
      expect(JSON.stringify({ headers: r.headers, body: r.body })).not.toContain(TOKEN);
    }

    const open = await start();
    const noToken = await rawRequest(open.port, { method: "POST", path: "/mcp", headers: mcpHeaders, body: initBody() });
    expect(noToken.status).toBe(200);
  });

  it("transport details", async () => {
    const srv = await start();
    const post = (headers: Record<string, string>, body: string) =>
      rawRequest(srv.port, { method: "POST", path: "/mcp", headers: { ...mcpHeaders, ...headers }, body });

    const plain = await rawRequest(srv.port, {
      method: "POST",
      path: "/mcp",
      headers: { "content-type": "text/plain" },
      body: initBody(),
    });
    expect(plain.status).toBe(415);

    const unknown = await post({}, JSON.stringify({ jsonrpc: "2.0", id: 7, method: "server/discover", params: {} }));
    expect((JSON.parse(unknown.body) as { error: { code: number } }).error.code).toBe(-32601);

    const init = await post({ "mcp-protocol-version": "2025-11-25" }, initBody("2025-06-18"));
    expect(init.status).toBe(200);
    expect((JSON.parse(init.body) as { result?: unknown }).result).toBeDefined();

    const list = await post(
      { "mcp-protocol-version": "2025-03-26" },
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: { _meta: { protocolVersion: "2025-11-25" } } }),
    );
    expect(list.status).toBe(200);
    expect((JSON.parse(list.body) as { result: { tools: unknown[] } }).result.tools).toHaveLength(9);
  });
});
