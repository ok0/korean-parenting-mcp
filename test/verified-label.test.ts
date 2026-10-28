import { describe, expect, it } from "vitest";
import { parseDate } from "../src/date/civil-date.js";
import { checkupItems } from "../src/timeline/rules/checkups.js";
import { renderItemLine } from "../src/timeline/render.js";
import type { TimelineItem } from "../src/timeline/types.js";
import { VERIFIED_LABEL } from "../src/tools/shared/format.js";
import { timelineSourceLine } from "../src/tools/shared/clinic-text.js";

describe("verified label per item (R6)", () => {
  const base = checkupItems(parseDate("2026-05-28"));
  const as = (item: TimelineItem, v: "full" | "partial" | "false"): TimelineItem => ({
    ...item,
    status: "예정",
    provenance:
      v === "full"
        ? {
            ...item.provenance,
            verified: "full",
            verified_by: "agent (ok0-editor) — needs human spot-check",
            verified_on: "2026-10-28",
          }
        : { ...item.provenance, verified: v },
  });
  const firstLine = (item: TimelineItem): string => renderItemLine(item).split("\n")[0]!;

  it("full label is 전체 검증", () => {
    expect(VERIFIED_LABEL.full).toBe("전체 검증");
  });

  it("(a) only full items show no 부분 검증", () => {
    const lines = base.slice(0, 3).map((i) => firstLine(as(i, "full")));
    for (const l of lines) expect(l.endsWith("| 전체 검증")).toBe(true);
    expect(lines.join("\n")).not.toContain("부분 검증");
  });

  it("(b) partial item keeps 부분 검증 on its line", () => {
    expect(firstLine(as(base[0]!, "partial")).endsWith("| 부분 검증")).toBe(true);
  });

  it("(c) mixed states render per item", () => {
    const full = as(base[0]!, "full");
    const partial = as(base[1]!, "partial");
    const off = as(base[2]!, "false");
    const lines = [full, partial, off].map((i) => firstLine(i));
    expect(lines[0]!.endsWith("| 전체 검증")).toBe(true);
    expect(lines[1]!.endsWith("| 부분 검증")).toBe(true);
    expect(lines[2]!.endsWith("| 미검증")).toBe(true);
    expect(timelineSourceLine([full.provenance, partial.provenance])).toContain("전체 검증/부분 검증");
  });
});
