import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createLawClient, toJo } from "../src/clients/law.js";
import type { ToolContext } from "../src/core/context.js";
import { ToolError } from "../src/core/errors.js";
import { runTool } from "../src/core/pipeline.js";
import { getTimelineTool } from "../src/tools/get-timeline.js";
import { createTestContext } from "./helpers/context.js";
import { createLawMock, htmlRes, jsonRes, sameAsStored, type LawMock } from "./helpers/law-mock.js";

const FAKE = "ab+c/d=e1";
const ENC = encodeURIComponent(FAKE);
const LAW_SEARCH = JSON.parse(readFileSync(new URL("./fixtures/law/law-search.json", import.meta.url), "utf8")) as unknown;
const LAWJOSUB_074 = JSON.parse(readFileSync(new URL("./fixtures/law/lawjosub-074.json", import.meta.url), "utf8")) as unknown;
const DAY_MS = 24 * 3600 * 1000;
const B = { reference_date: "2026-10-28", birth_date: "2026-05-28" };

const text = (r: { content: { type: string; text?: string }[] }): string => r.content[0]!.text ?? "";

let now = Date.parse("2026-10-28T00:00:00+09:00");

function ctxOf(mock: LawMock, sink?: (line: string) => void): ToolContext {
  return {
    ...createTestContext({ env: { LAW_OC: FAKE }, sink }),
    fetch: mock.fetch,
    clock: { now: () => new Date(now) },
  };
}

function fixtureRoute(target: string | null): Response | undefined {
  if (target === "law") return jsonRes(LAW_SEARCH);
  if (target === "lawjosub") return jsonRes(LAWJOSUB_074);
  return undefined;
}

describe("law cache", () => {
  it("repeated revision and article lookups fetch once within TTL", async () => {
    const mock = createLawMock((url) => fixtureRoute(url.searchParams.get("target")));
    const ctx = ctxOf(mock);
    const client = createLawClient(ctx);

    const first = await client.searchLaw("근로기준법");
    const second = await client.searchLaw("근로기준법");
    expect(mock.urls).toHaveLength(1);
    expect(second).toEqual(first);

    await client.getArticle("TEST-LAW-1", toJo(74));
    await client.getArticle("TEST-LAW-1", toJo(74));
    expect(mock.urls).toHaveLength(2);

    const fresh = createLawClient(ctx);
    await fresh.searchLaw("근로기준법");
    expect(mock.urls).toHaveLength(2);

    now += DAY_MS;
    await client.searchLaw("근로기준법");
    expect(mock.urls).toHaveLength(3);
    await client.getArticle("TEST-LAW-1", toJo(74));
    expect(mock.urls).toHaveLength(4);
  });

  it("failures are not cached", async () => {
    const cases: { name: string; route: () => Response }[] = [
      { name: "html", route: () => htmlRes() },
      { name: "empty", route: () => new Response("", { status: 200, headers: { "content-type": "application/json" } }) },
      { name: "http500", route: () => jsonRes({}, 500) },
    ];
    for (const c of cases) {
      const mock = createLawMock(() => c.route());
      const client = createLawClient(ctxOf(mock));
      await expect(client.searchLaw("x")).rejects.toBeInstanceOf(ToolError);
      await expect(client.searchLaw("x")).rejects.toMatchObject({ kind: "UPSTREAM" });
      expect(mock.urls, c.name).toHaveLength(2);
    }
  });

  it("cache keys and logs carry no OC", async () => {
    const lines: string[] = [];
    const mock = createLawMock((url) => fixtureRoute(url.searchParams.get("target")));
    const ctx = ctxOf(mock, (line) => lines.push(line));
    const client = createLawClient(ctx);
    await client.searchLaw("근로기준법");
    await client.getArticle("TEST-LAW-1", toJo(74));

    const keys = ctx.cache.keys();
    expect(keys.length).toBeGreaterThanOrEqual(1);
    for (const k of keys) {
      expect(k).not.toContain(FAKE);
      expect(k).not.toContain(ENC);
      expect(k).not.toContain("OC=");
    }
    for (const line of lines) {
      expect(line).not.toContain(FAKE);
      expect(line).not.toContain(ENC);
    }
  });

  it("get_timeline output identical with and without cache", async () => {
    const mock = createLawMock(sameAsStored(FAKE));
    const ctx = ctxOf(mock);
    const first = text(await runTool(getTimelineTool, B, ctx));
    const n1 = mock.urls.length;
    expect(n1).toBeGreaterThan(0);

    const second = text(await runTool(getTimelineTool, B, ctx));
    expect(second).toBe(first);
    expect(mock.urls).toHaveLength(n1);

    const mock2 = createLawMock(sameAsStored(FAKE));
    const third = text(await runTool(getTimelineTool, B, ctxOf(mock2)));
    expect(third).toBe(first);
  });
});
