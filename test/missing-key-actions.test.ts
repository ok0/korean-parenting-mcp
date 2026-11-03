import { describe, expect, it } from "vitest";
import { z } from "zod";
import { formatToolError, missingKeyError } from "../src/core/errors.js";
import type { KeyName } from "../src/core/config.js";
import { runTool } from "../src/core/pipeline.js";
import { defineTool } from "../src/tools/registry.js";
import { createTestContext } from "./helpers/context.js";
import { keyTool } from "./helpers/fixture-tools.js";

describe("missingKeyError extra actions", () => {
  it("no extra keeps actions identical", () => {
    const cases: KeyName[][] = [["DATA_GO_KR"], ["DATA_GO_KR", "LAW_OC"]];
    for (const k of cases) {
      const base = missingKeyError(k);
      for (const other of [missingKeyError(k, undefined), missingKeyError(k, [])]) {
        expect(other.message).toBe(base.message);
        expect(other.actions).toEqual(base.actions);
        expect(other.detail).toEqual(base.detail);
        expect(other.kind).toBe(base.kind);
      }
    }
  });

  it("extra lines are appended at the end", () => {
    const e = missingKeyError(["DATA_GO_KR"], ["추가 안내 A"]);
    expect(e.actions.at(-1)).toBe("추가 안내 A");
    expect(e.actions.slice(0, -1)).toEqual(missingKeyError(["DATA_GO_KR"]).actions);
  });

  it("pipeline passes keyActions", async () => {
    const def = defineTool({
      name: "key_actions_fixture",
      title: "t",
      description: "d",
      schema: z.object({}),
      annotations: { readOnlyHint: true as const, idempotentHint: true, openWorldHint: false },
      requiredKeys: ["DATA_GO_KR"],
      keyActions: ["활용신청 안내 줄"],
      handler: async () => ({ body: "x" }),
    });
    const res = await runTool(def, {}, createTestContext());
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text.endsWith("- 활용신청 안내 줄")).toBe(true);
  });

  it("tool without keyActions is byte-identical to formatToolError(missingKeyError)", async () => {
    const ctx = createTestContext();
    const res = await runTool(keyTool, {}, ctx);
    const expected = formatToolError(missingKeyError(["DATA_GO_KR"]), keyTool.name, ctx);
    expect(res.content[0]!.text).toBe(expected.content[0]!.text);
  });
});
