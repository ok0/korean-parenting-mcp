import { describe, expect, it } from "vitest";
import { runTool } from "../src/core/pipeline.js";
import { getTimelineTool } from "../src/tools/get-timeline.js";
import { localGuidance } from "../src/timeline/rules/local.js";
import { createTestContext } from "./helpers/context.js";

const REF = "2026-10-28";

const call = (args: Record<string, unknown>) => runTool(getTimelineTool, args, createTestContext());
const text = (r: { content: { type: string; text?: string }[] }): string => r.content[0]!.text ?? "";

function body(t: string): string {
  return t.split("\n\n---\n")[0]!;
}

function footer(t: string): string {
  return t.slice(t.indexOf("\n\n---\n"));
}

function itemLines(t: string): string[] {
  return body(t).split("\n").filter((l) => l.startsWith("- ["));
}

describe("local guidance section", () => {
  it("region fills contacts", async () => {
    const t = text(await call({ due_date: "2027-02-10", reference_date: REF, region: "성동구" }));
    const b = body(t);
    expect(b).toContain("지역·기관별 확인 사항");
    expect(b).toContain("보건소 산전검사");
    expect(b).toContain("어린이집 입소대기");
    expect(b).toContain("지자체 추가 지원");
    expect(b).toContain("성동구 보건소에 확인");
    expect(b).toContain("성동구 시·군·구청");
    const waitlist = b.split("\n").find((l) => l.startsWith("- 어린이집 입소대기"))!;
    expect(waitlist).toContain("확인되지 않음");
    expect(waitlist).not.toMatch(/신청할 수 있습니다|신청 가능합니다/);
  });

  it("missing region prompts input", async () => {
    const t = text(await call({ due_date: "2027-02-10", reference_date: REF }));
    expect(t).toContain("지역을 입력하면 확인처가 구체화됩니다");
  });

  it("section shown with zero items", async () => {
    const t = text(await call({ birth_date: "2005-01-01", reference_date: "2026-01-01" }));
    expect(t).toContain("표시할 항목이 없습니다");
    expect(t).toContain("지역·기관별 확인 사항");
  });

  it("region does not change dates or amounts", async () => {
    const args = { due_date: "2027-02-10", reference_date: REF };
    const a = itemLines(text(await call({ ...args, region: "성동구" })));
    const b = itemLines(text(await call({ ...args, region: "강남구" })));
    expect(a.length).toBeGreaterThan(0);
    expect(a).toEqual(b);
  });

  it("born mode omits prenatal guidance", async () => {
    const t = text(await call({ birth_date: "2026-05-28", reference_date: REF, region: "성동구" }));
    expect(t).not.toContain("보건소 산전검사");
    expect(t).toContain("어린이집 입소대기");
    expect(footer(t)).not.toContain("mch-act-rule-annex1");
    expect(footer(t)).toContain("childcare-waitlist-portal");
  });

  it("localGuidance lines per mode", () => {
    const pregnant = localGuidance({ mode: "pregnant" });
    expect(pregnant.lines).toHaveLength(3);
    expect(pregnant.missingNote).toBeDefined();

    const born = localGuidance({ mode: "born", region: "성동구" });
    expect(born.lines).toHaveLength(2);
    expect(born.missingNote).toBeUndefined();
  });
});
