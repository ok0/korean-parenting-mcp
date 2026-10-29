import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, afterAll } from "vitest";
import { TtlCache } from "../../src/core/cache.js";
import { loadConfig } from "../../src/core/config.js";
import { createDefaultContext, type ToolContext } from "../../src/core/context.js";
import { createLogger } from "../../src/core/logger.js";
import { remoteTools } from "../../src/remote/allowlist.js";
import { createServer } from "../../src/server/create-server.js";
import { allTools } from "../../src/tools/registry.js";
import { createDgkMock, TEST_KEY as DGK_KEY } from "../helpers/dgk-mock.js";
import { createKgMock, KG_TEST_KEY } from "../helpers/kg-mock.js";
import { createLawMock, sameAsStored } from "../helpers/law-mock.js";
import { createNemcMock } from "../helpers/nemc-mock.js";
import { startRemote, type StartedRemote } from "../helpers/remote-server.js";

const FAKE = "ab+c/d=e1";
const clock = { now: () => new Date("2026-10-28T21:30:00+09:00") };
const silent = createLogger([], "error", () => {});

const ENV = { DATA_GO_KR_SERVICE_KEY: DGK_KEY, KINDERGARTEN_API_KEY: KG_TEST_KEY, LAW_OC: FAKE };

const FIRST: Record<string, Record<string, unknown>> = {
  get_timeline: { birth_date: "2026-01-31", reference_date: "2026-02-01" },
  get_leave_article: { topic: "maternity_leave" },
  find_night_pediatric: { region: "성동구", limit: "2" },
  find_benefits: { limit: "2" },
  check_pregnancy_drug: { drug_name: "아세트아미노펜", limit: "2" },
  find_daycare: { birth_date: "2026-05-28", due_date: "2027-03-15" },
  find_vaccination_clinic: { birth_date: "2026-05-28", due_date: "2027-03-15" },
  find_checkup_clinic: { birth_date: "2026-05-28", due_date: "2027-03-15" },
  find_kindergarten: { region: "성동구", age: "4", limit: "5" },
};

const OVERSIZED = { __oversized: "x".repeat(3000) };

const CASES: { tool: string; args: Record<string, unknown> }[] = remoteTools(allTools).flatMap((t) => [
  { tool: t.name, args: FIRST[t.name]! },
  { tool: t.name, args: OVERSIZED },
]);

function compositeFetch(): typeof fetch {
  const law = createLawMock(sameAsStored(FAKE));
  const kg = createKgMock();
  const dgk = createDgkMock();
  const nemc = createNemcMock();
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href);
    if (url.hostname === "www.law.go.kr") return law.fetch(input, init);
    if (url.hostname === "e-childschoolinfo.moe.go.kr") return kg.fetch(input, init);
    if (url.pathname.endsWith("/serviceList") || url.pathname.endsWith("/getPwnmTabooInfoList03")) {
      return dgk.fetch(input, init);
    }
    return nemc.fetch(input, init);
  }) as typeof fetch;
}

type CallOut = { content: unknown; isError?: boolean };

const normRevision = (content: unknown): string =>
  JSON.stringify(
    (content as { type: string; text?: string }[]).map((c) =>
      c.text === undefined ? c : { ...c, text: c.text.replace(/개정 확인[^\n]*/g, "개정 확인<norm>") },
    ),
  );
const same = (tool: string, content: unknown): string =>
  tool === "get_timeline" ? normRevision(content) : JSON.stringify(content);

async function runInMemory(env: Record<string, string>, fx: typeof fetch, cases: typeof CASES): Promise<CallOut[]> {
  const ctx = createDefaultContext(loadConfig(env), { clock, fetch: fx, cache: new TtlCache(), log: silent });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const server = createServer(ctx);
  await server.connect(st);
  const client = new Client({ name: "t", version: "0" });
  await client.connect(ct);
  const out: CallOut[] = [];
  for (const c of cases) out.push((await client.callTool({ name: c.tool, arguments: c.args })) as CallOut);
  await client.close();
  await server.close();
  return out;
}

async function runHttp(
  env: Record<string, string>,
  fx: typeof fetch,
  cases: typeof CASES,
  opened: StartedRemote[],
): Promise<CallOut[]> {
  const ctxOver: Partial<ToolContext> = { clock, fetch: fx, cache: new TtlCache() };
  const srv = await startRemote({}, ctxOver, env);
  opened.push(srv);
  const client = new Client({ name: "t", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(srv.url));
  const out: CallOut[] = [];
  for (const c of cases) out.push((await client.callTool({ name: c.tool, arguments: c.args })) as CallOut);
  await client.close();
  return out;
}

const opened: StartedRemote[] = [];
afterAll(async () => {
  while (opened.length) await opened.pop()!.close();
});

describe("remote parity with local surface", () => {
  it("exposed tools cover every CASES tool", () => {
    expect(new Set(CASES.map((c) => c.tool))).toEqual(new Set(remoteTools(allTools).map((t) => t.name)));
    expect(new Set(CASES.map((c) => c.tool)).size).toBe(8);
  });

  it("8 exposed tools x 2 inputs answer identically over InMemory and HTTP", async () => {
    const mem = await runInMemory(ENV, compositeFetch(), CASES);
    const http = await runHttp(ENV, compositeFetch(), CASES, opened);
    expect(http.length).toBe(mem.length);
    for (let i = 0; i < CASES.length; i++) {
      const label = `${CASES[i]!.tool} #${i}`;
      expect(same(CASES[i]!.tool, http[i]!.content), label).toBe(same(CASES[i]!.tool, mem[i]!.content));
      expect(Boolean(http[i]!.isError), label).toBe(Boolean(mem[i]!.isError));
    }
  });

  it("get_timeline offline keyless", async () => {
    const failing: typeof fetch = async () => {
      throw new Error("offline");
    };
    const args = FIRST.get_timeline!;
    const cases = [{ tool: "get_timeline", args }];
    const http = await runHttp({}, failing, cases, opened);
    const mem = await runInMemory({}, failing, cases);
    expect(http[0]!.isError).toBeFalsy();
    expect(normRevision(http[0]!.content)).toBe(normRevision(mem[0]!.content));
  });

  it("remote get_timeline: no law.go.kr calls and original links (AC2)", async () => {
    const inner = compositeFetch();
    let lawCalls = 0;
    const counted: typeof fetch = (input, init) => {
      const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (new URL(href).hostname === "www.law.go.kr") lawCalls++;
      return inner(input, init);
    };
    const http = await runHttp(ENV, counted, [{ tool: "get_timeline", args: FIRST.get_timeline! }], opened);
    expect(lawCalls).toBe(0);
    const text = (http[0]!.content as { text: string }[]).map((c) => c.text).join("\n");
    expect(text).toContain("개정 여부 확인 불가(원격) 원문: https://");
    expect(text).not.toContain("법제처 OC 미설정");
  });

  it("KPM_LAW_REMOTE=on leaves revisionCheck unset", async () => {
    const on = await startRemote({}, {}, { KPM_LAW_REMOTE: "on" });
    opened.push(on);
    expect(on.deps.baseCtx.revisionCheck).toBeUndefined();
    const off = await startRemote();
    opened.push(off);
    expect(off.deps.baseCtx.revisionCheck).toBe("remote-unavailable");
  });
});
