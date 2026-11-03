import { describe, expect, it } from "vitest";
import { runTool } from "../src/core/pipeline.js";
import { allTools, type ToolDef } from "../src/tools/registry.js";
import { checkPregnancyDrugTool } from "../src/tools/check-pregnancy-drug.js";
import { checkRecallTool } from "../src/tools/check-recall.js";
import { findBenefitsTool } from "../src/tools/find-benefits.js";
import { findKindergartenTool } from "../src/tools/find-kindergarten.js";
import { findNightPediatricTool } from "../src/tools/find-night-pediatric.js";
import { getLeaveArticleTool } from "../src/tools/get-leave-article.js";
import { createTestContext } from "./helpers/context.js";

const CASES: [ToolDef, Record<string, unknown>][] = [
  [getLeaveArticleTool, { topic: "maternity_leave" }],
  [findNightPediatricTool, { region: "성동구" }],
  [findBenefitsTool, { stage: "pregnancy" }],
  [checkPregnancyDrugTool, { drug_name: "아세트아미노펜" }],
  [checkRecallTool, { product_name: "카시트" }],
  [findKindergartenTool, { region: "성동구" }],
];

describe("unset keys snapshot", () => {
  it("covers every registered keyed tool", () => {
    expect(
      allTools
        .filter((t) => (t.requiredKeys ?? []).length > 0)
        .map((t) => t.name)
        .sort(),
    ).toEqual(CASES.map((c) => c[0].name).sort());
  });

  it("missing-key output is byte-stable", async () => {
    const ctx = {
      ...createTestContext({ env: {} }),
      fetch: (async () => {
        throw new Error("network disabled");
      }) as unknown as typeof fetch,
    };
    const parts: string[] = [];
    for (const [def, args] of CASES) {
      const r = await runTool(def, args, ctx);
      expect(r.isError).toBe(true);
      parts.push(`=== ${def.name} ===\n${r.content[0]!.text}`);
    }
    await expect(parts.join("\n\n") + "\n").toMatchFileSnapshot("./__snapshots__/unset-keys.txt");
  });
});
