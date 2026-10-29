import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ToolContext } from "../src/core/context.js";
import { finalize, runTool } from "../src/core/pipeline.js";
import { staleNotice } from "../src/core/upstream-guard.js";
import { defineTool, type ToolOutput } from "../src/tools/registry.js";
import { createTestContext } from "./helpers/context.js";

const noticeTool = defineTool({
  name: "notice_probe",
  title: "notice probe",
  description: "test tool that emits notices",
  schema: z.object({ stale: z.boolean(), delayMs: z.number(), long: z.number().optional() }),
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  maxChars: 2000,
  async handler(args, ctx): Promise<ToolOutput> {
    await new Promise((r) => setTimeout(r, args.delayMs));
    if (args.stale) {
      ctx.notices?.push(staleNotice(120_000), staleNotice(120_000));
    }
    return { body: "B".repeat(args.long ?? 3), footer: "---\nF" };
  },
});

function textOf(r: { content: { type: "text"; text: string }[] }): string {
  return r.content[0]?.text ?? "";
}

describe("pipeline notices", () => {
  it("notices appended once at footer end", async () => {
    const text = textOf(
      await runTool(noticeTool, { stale: true, delayMs: 0 }, { ...createTestContext(), notices: [] }),
    );
    const notice = staleNotice(120_000);
    expect(text.endsWith("\n\n---\nF\n" + notice)).toBe(true);
    expect(text.split(notice).length - 1).toBe(1);
  });

  it("truncation keeps notice", async () => {
    const text = textOf(
      await runTool(noticeTool, { stale: true, delayMs: 0, long: 20_000 }, { ...createTestContext(), notices: [] }),
    );
    expect(text).toContain("자 생략");
    expect(text.endsWith(staleNotice(120_000))).toBe(true);
    expect(text.length).toBeLessThanOrEqual(2000 + 200);
  });

  it("concurrent requests isolated", async () => {
    const base: ToolContext = { ...createTestContext(), notices: [] };
    const [a, b] = await Promise.all([
      runTool(noticeTool, { stale: true, delayMs: 20 }, base),
      runTool(noticeTool, { stale: false, delayMs: 5 }, base),
    ]);
    expect(textOf(a)).toContain("저장된 정보");
    expect(textOf(b)).not.toContain("저장된 정보");
    expect(base.notices).toEqual([]);
  });

  it("no notices field gives byte identical output", async () => {
    const secrets = ["SECRETKEY"];
    const outputs: ToolOutput[] = [
      { body: "abc" },
      { body: "abc", footer: "F" },
      { body: "x".repeat(3000), footer: "F" },
      { body: "y".repeat(50), footer: undefined },
    ];
    for (const o of outputs) {
      const plain = finalize(o, 2000, secrets);
      expect(finalize(o, 2000, secrets, [])).toBe(plain);
      expect(finalize(o, 2000, secrets, undefined)).toBe(plain);
    }

    let seen: ToolContext | undefined;
    const probe = defineTool({
      name: "identity_probe",
      title: "identity probe",
      description: "captures ctx identity",
      schema: z.object({}),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      handler: async (_args, ctx): Promise<ToolOutput> => {
        seen = ctx;
        return { body: "ok" };
      },
    });
    const base = createTestContext();
    await runTool(probe, {}, base);
    expect(seen).toBe(base);
  });
});
