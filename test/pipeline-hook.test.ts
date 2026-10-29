import { describe, expect, it } from "vitest";
import type { ToolContext } from "../src/core/context.js";
import { runTool } from "../src/core/pipeline.js";
import { createTestContext } from "./helpers/context.js";
import { echoTool, throwTool, upstreamTool } from "./helpers/fixture-tools.js";

type Event = NonNullable<ToolContext["onToolDone"]> extends (e: infer E) => void ? E : never;

describe("pipeline onToolDone hook", () => {
  it("reports success once", async () => {
    const ctx = createTestContext();
    const calls: Event[] = [];
    await runTool(echoTool, { text: "안녕" }, { ...ctx, onToolDone: (e) => calls.push(e) });
    expect(calls.length).toBe(1);
    expect(calls[0]?.tool).toBe("fx_echo");
    expect(calls[0]?.ok).toBe(true);
    expect(typeof calls[0]?.ms).toBe("number");
    expect(calls[0]).not.toHaveProperty("kind");
  });

  it("reports validation failure as BAD_INPUT", async () => {
    const ctx = createTestContext();
    const calls: Event[] = [];
    await runTool(echoTool, { text: 5 }, { ...ctx, onToolDone: (e) => calls.push(e) });
    expect(calls.length).toBe(1);
    expect(calls[0]?.ok).toBe(false);
    expect(calls[0]?.kind).toBe("BAD_INPUT");
  });

  it("reports tool error kind", async () => {
    const ctx = createTestContext();
    const calls: Event[] = [];
    const hook = { onToolDone: (e: Event) => calls.push(e) };
    await runTool(upstreamTool, {}, { ...ctx, ...hook });
    await runTool(throwTool, {}, { ...ctx, ...hook });
    expect(calls.length).toBe(2);
    expect(calls[0]?.kind).toBe("UPSTREAM");
    expect(calls[1]?.kind).toBe("INTERNAL");
  });

  it("result identical with and without hook", async () => {
    const ctx = createTestContext();
    const cases: [typeof echoTool, unknown][] = [
      [echoTool, { text: "안녕" }],
      [echoTool, { text: 5 }],
      [upstreamTool, {}],
      [throwTool, {}],
    ];
    for (const [def, args] of cases) {
      const withHook = await runTool(def, args, { ...ctx, onToolDone: () => {} });
      const without = await runTool(def, args, ctx);
      expect(withHook).toEqual(without);
    }
  });

  it("hook that throws does not change result", async () => {
    const ctx = createTestContext();
    const throwing = { ...ctx, onToolDone: () => { throw new Error("x"); } };
    expect(await runTool(echoTool, { text: "안녕" }, throwing)).toEqual(
      await runTool(echoTool, { text: "안녕" }, ctx),
    );
    expect(await runTool(upstreamTool, {}, throwing)).toEqual(await runTool(upstreamTool, {}, ctx));
  });
});
