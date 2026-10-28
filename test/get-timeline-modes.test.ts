import { describe, expect, it } from "vitest";
import { z } from "zod";
import { addDays, formatDate, parseDate } from "../src/date/civil-date.js";
import { runTool } from "../src/core/pipeline.js";
import { getTimelineTool } from "../src/tools/get-timeline.js";
import { ESTIMATED_NOTE } from "../src/tools/shared/format.js";
import { createTestContext } from "./helpers/context.js";

const REF = "2026-10-28";

const call = (args: Record<string, unknown>) => runTool(getTimelineTool, args, createTestContext());
const text = (r: { content: { type: string; text?: string }[] }): string => r.content[0]!.text ?? "";

function body(t: string): string {
  return t.split("\n\n---\n")[0]!;
}

function blocks(t: string): string[] {
  return body(t)
    .split(/\n(?=- \[)/)
    .filter((b) => b.startsWith("- ["));
}

function shift(base: string, days: number): string {
  return formatDate(addDays(parseDate(base), days));
}

describe("get_timeline modes", () => {
  it("rejects invalid mode inputs", async () => {
    const cases: [Record<string, unknown>, string[]][] = [
      [{}, ["due_date", "birth_date"]],
      [{ due_date: "2027-02-10", birth_date: "2026-01-31", reference_date: REF }, ["due_date", "birth_date"]],
      [{ due_date: "2027-02-10", reference_date: REF, fetus_count: 0 }, ["fetus_count"]],
      [{ due_date: "2027-02-10", reference_date: REF, fetus_count: 5 }, ["fetus_count"]],
      [{ due_date: "2027-02-10", reference_date: REF, birth_order: 0 }, ["birth_order"]],
      [{ due_date: "2027-02-10", reference_date: REF, birth_order: 11 }, ["birth_order"]],
      [{ due_date: "2027-02-10", reference_date: REF, region: "가".repeat(41) }, ["region"]],
      [{ due_date: shift(REF, 301), reference_date: REF }, ["birth_date"]],
      [{ due_date: shift(REF, -91), reference_date: REF }, ["birth_date"]],
      [{ birth_date: "2026-11-01", reference_date: REF }, ["due_date"]],
    ];
    for (const [args, fields] of cases) {
      const r = await call(args);
      expect(r.isError, JSON.stringify(args)).toBe(true);
      for (const f of fields) expect(text(r), JSON.stringify(args)).toContain(f);
      expect(text(r)).toContain("예:");
    }
  });

  it("accepts boundary and alternate formats", async () => {
    for (const due of [shift(REF, 300), shift(REF, -90)]) {
      const r = await call({ due_date: due, reference_date: REF });
      expect(r.isError, due).toBeFalsy();
    }
    const compact = await call({ due_date: "20270210", reference_date: REF, fetus_count: "2" });
    expect(compact.isError).toBeFalsy();
    expect(text(compact)).toContain("출산예정일 2027-02-10");

    const dotted = await call({ due_date: "2027.02.10", reference_date: REF });
    expect(dotted.isError).toBeFalsy();
    expect(text(dotted)).toContain("출산예정일 2027-02-10");
  });

  it("overdue due date notice", async () => {
    const r = await call({ due_date: shift(REF, -30), reference_date: REF });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toContain("예정일이 지났습니다");
  });

  it("pregnant mode adds prenatal and estimated marks", async () => {
    const r = await call({ due_date: "2027-02-10", reference_date: REF });
    expect(r.isError).toBeFalsy();
    const t = text(r);
    const b = body(t);
    expect(b.match(/\| 산전 정기 건강진단/g)).toHaveLength(3);
    expect(b).toContain("| 인플루엔자 임신부");

    const registration = blocks(t).find((x) => x.includes("| 출생신고 기한"));
    expect(registration).toBeDefined();
    expect(registration).toContain(ESTIMATED_NOTE);

    const all = blocks(t);
    expect(all.length).toBeGreaterThan(0);
    for (const block of all) expect(block).toContain(ESTIMATED_NOTE);

    expect(b.includes("다태아") || b.includes("fetus_count")).toBe(true);
  });

  it("born mode has no pregnancy items", async () => {
    const r = await call({ birth_date: "2026-05-28", reference_date: REF });
    expect(r.isError).toBeFalsy();
    const t = text(r);
    expect(t).not.toContain("산전 정기 건강진단");
    expect(t).not.toContain("인플루엔자 임신부");
    expect(t).not.toContain("추정");
  });

  it("field descriptions include examples", () => {
    const json = z.toJSONSchema(getTimelineTool.schema, { io: "input" }) as {
      properties: Record<string, { description?: string }>;
    };
    expect(json.properties.due_date!.description).toContain("예: 2027-02-10");
    expect(json.properties.region!.description).toContain("예: 성동구");
    expect(json.properties.birth_order!.description).toContain("예: 1");
    expect(json.properties.fetus_count!.description).toContain("예: 2");
  });
});
