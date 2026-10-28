import { describe, expect, it } from "vitest";
import { addMonthsClamp, addDays, parseDate, type CivilDate } from "../src/date/civil-date.js";
import { bundledCalendar, createCalendar } from "../src/date/holiday-calendar.js";
import { buildTimeline, compareItems, statusOf } from "../src/timeline/engine.js";
import type { TimelineInput, TimelineItem, TimelineRule } from "../src/timeline/types.js";

const R = parseDate("2026-06-15");
const cal = createCalendar({}, []);
const prov = { basis_ids: ["b1"], as_of: "2026-10-28", verified: "partial" as const };

function item(id: string, start: CivilDate, end?: CivilDate): TimelineItem {
  return {
    id,
    category: "신고",
    title: id,
    nature: "법정 의무",
    start,
    end,
    notes: [],
    provenance: { ...prov, basis_ids: [...prov.basis_ids] },
  };
}

function fixed(items: TimelineItem[]): TimelineRule[] {
  return [() => items.map((it) => ({ ...it, provenance: { ...it.provenance, basis_ids: [...it.provenance.basis_ids] } }))];
}

function input(over: Partial<TimelineInput> = {}): TimelineInput {
  return {
    birthDate: R,
    referenceDate: R,
    monthsAhead: 12,
    includePast: false,
    holidays: cal,
    ...over,
  };
}

describe("statusOf", () => {
  it("status boundaries", () => {
    expect(statusOf(addDays(R, -10), R, R)).toBe("진행 중");
    expect(statusOf(addDays(R, -10), addDays(R, -1), R)).toBe("지난");
    expect(statusOf(addDays(R, 14), addDays(R, 20), R)).toBe("임박");
    expect(statusOf(addDays(R, 15), addDays(R, 20), R)).toBe("예정");
    expect(statusOf(R, addDays(R, 5), R)).toBe("진행 중");
    expect(statusOf(R, undefined, R)).toBe("진행 중");
    expect(statusOf(addDays(R, -1), undefined, R)).toBe("지난");
  });
});

describe("compareItems", () => {
  it("sorts by start, end, id", () => {
    const sorted = [
      item("b", R, addDays(R, 5)),
      item("a", R, addDays(R, 5)),
      item("c", R, addDays(R, 2)),
      item("d", addDays(R, -1), addDays(R, 9)),
    ].sort(compareItems);
    expect(sorted.map((it) => it.id)).toEqual(["d", "c", "a", "b"]);
  });
});

describe("buildTimeline", () => {
  it("hides past unless includePast", () => {
    const rules = fixed([
      item("p1", addDays(R, -20), addDays(R, -10)),
      item("p2", addDays(R, -9), addDays(R, -1)),
      item("now", addDays(R, -3), addDays(R, 3)),
    ]);
    const hidden = buildTimeline(input({ includePast: false }), rules);
    expect(hidden.items).toHaveLength(1);
    expect(hidden.hiddenPast).toBe(2);

    const shown = buildTimeline(input({ includePast: true }), rules);
    expect(shown.items).toHaveLength(3);
    expect(shown.hiddenPast).toBe(0);
  });

  it("hides items starting after horizon", () => {
    const horizon = addMonthsClamp(R, 1);
    const rules = fixed([item("edge", horizon), item("late", addDays(horizon, 1))]);
    const result = buildTimeline(input({ monthsAhead: 1 }), rules);
    expect(result.items.map((it) => it.id)).toEqual(["edge"]);
    expect(result.hiddenFuture).toBe(1);
  });

  it("basisIds include hidden items and warnings are deduped", () => {
    const past = { ...item("past", addDays(R, -10), addDays(R, -1)), provenance: { ...prov, basis_ids: ["b2"] } };
    const shown = { ...item("shown", R, addDays(R, 5)), provenance: { ...prov, basis_ids: ["b1"] } };
    const result = buildTimeline(input({ includePast: false }), fixed([shown, past]));
    expect(result.basisIds).toEqual(["b2", "b1"]);

    const warned = buildTimeline(
      input({ holidays: createCalendar({}, ["n1", "n1", "n2"]) }),
      fixed([]),
    );
    expect(warned.warnings).toEqual(["n1", "n2"]);
  });

  it("notice rules are applied and deduped", () => {
    expect(buildTimeline(input(), fixed([]), [() => ["n1", "n1"], () => ["n2"]]).notices).toEqual(["n1", "n2"]);
    expect(buildTimeline(input(), fixed([]), []).notices).toEqual([]);
  });

  it("default rules are deterministic", () => {
    const inp = input({
      birthDate: parseDate("2026-01-31"),
      referenceDate: parseDate("2026-02-01"),
      monthsAhead: 156,
      includePast: true,
      holidays: bundledCalendar(),
    });
    expect(buildTimeline(inp)).toEqual(buildTimeline(inp));
  });
});
