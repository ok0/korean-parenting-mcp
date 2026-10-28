import { describe, expect, it, vi } from "vitest";
import { KEY_ENV } from "../src/core/config.js";
import { runTool } from "../src/core/pipeline.js";
import { getLeaveArticleTool } from "../src/tools/get-leave-article.js";
import { getTimelineTool } from "../src/tools/get-timeline.js";
import { createTestContext } from "./helpers/context.js";

const ENV_NAMES = Object.values(KEY_ENV);

const CASES: Record<string, Record<string, string>> = {
  unset: {},
  empty: Object.fromEntries(ENV_NAMES.map((n) => [n, ""])),
  placeholder: Object.fromEntries(ENV_NAMES.map((n) => [n, `${"$"}{user_config.${n}}`])),
};

describe("unset keys", () => {
  it.each(Object.entries(CASES))("%s: server keys unset, no fetch", async (_name, env) => {
    const fetchSpy = vi.fn(async () => {
      throw new Error("network disabled");
    });
    const ctx = { ...createTestContext({ env }), fetch: fetchSpy as unknown as typeof fetch };
    expect(ctx.config.keys).toEqual({});

    const leave = await runTool(getLeaveArticleTool, { topic: "maternity_leave" }, ctx);
    expect(leave.isError).toBe(true);
    const leaveText = leave.content[0]!.text;
    expect(leaveText).toContain("LAW_OC");
    expect(leaveText).toContain("설정되지 않았습니다");

    const timeline = await runTool(getTimelineTool, { birth_date: "2026-05-28", reference_date: "2026-10-28" }, ctx);
    expect(timeline.isError).toBeFalsy();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fake LAW_OC is treated as set (regression)", async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error("network disabled");
    });
    const ctx = {
      ...createTestContext({ env: { LAW_OC: "fake-oc-123" } }),
      fetch: fetchSpy as unknown as typeof fetch,
    };
    const leave = await runTool(getLeaveArticleTool, { topic: "maternity_leave" }, ctx);
    expect(leave.content[0]!.text).not.toContain("필요한 API 키가 설정되지 않았습니다");
    expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
  });
});
