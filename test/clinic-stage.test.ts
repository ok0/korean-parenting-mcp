import { describe, expect, it } from "vitest";
import {
  birthDoses,
  checkupRoundTable,
  checkupWindows,
  childStage,
  firstInfantRound,
  pickWindows,
  vaccineWindows,
  type WindowItem,
} from "../src/clinic/stage.js";
import { formatDate, parseDate } from "../src/date/civil-date.js";
import { doseItems, influenzaItems } from "../src/timeline/rules/vaccination.js";
import { checkupItems } from "../src/timeline/rules/checkups.js";

const today = parseDate("2026-10-28");

function win(id: string, start: string, end: string): WindowItem {
  return {
    id,
    title: id,
    start: parseDate(start),
    end: parseDate(end),
    notes: [],
    provenance: { basis_ids: ["test-basis"], as_of: "2026-10-28", verified: "partial" },
  };
}

function ids(items: readonly WindowItem[]): string[] {
  return items.map((i) => i.id);
}

describe("childStage", () => {
  it("due date in future is due stage", () => {
    expect(childStage({ due: parseDate("2027-03-15") }, today)).toEqual({
      ok: true,
      stage: { kind: "due", due: parseDate("2027-03-15") },
    });
  });

  it("due date in past is rejected", () => {
    const r = childStage({ due: parseDate("2026-10-01") }, today);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("birth_date");
  });

  it("birth date in future is rejected", () => {
    const r = childStage({ birth: parseDate("2026-11-01") }, today);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("due_date");
  });

  it("birth date gives months", () => {
    const r = childStage({ birth: parseDate("2026-05-28") }, today);
    expect(r).toEqual({ ok: true, stage: { kind: "birth", birth: parseDate("2026-05-28"), months: 5 } });
  });

  it("no input is none stage", () => {
    expect(childStage({}, today)).toEqual({ ok: true, stage: { kind: "none" } });
  });
});

describe("pickWindows synthetic", () => {
  const items = [
    win("a", "2026-01-01", "2026-01-31"),
    win("b", "2026-02-01", "2026-02-28"),
    win("c", "2026-03-01", "2026-03-31"),
    win("d", "2026-03-01", "2026-04-30"),
  ];

  it("current, recent and next around a gap", () => {
    const p = pickWindows(items, parseDate("2026-02-10"));
    expect(ids(p.current)).toEqual(["b"]);
    expect(ids(p.recent)).toEqual(["a"]);
    expect(ids(p.next)).toEqual(["c", "d"]);
    expect(p.nextStart && formatDate(p.nextStart)).toBe("2026-03-01");
    expect(p.imminent).toBe(false);
  });

  it("imminent within the window", () => {
    expect(pickWindows(items, parseDate("2026-02-20")).imminent).toBe(true);
  });

  it("current at the first day", () => {
    expect(ids(pickWindows(items, parseDate("2026-01-31")).current)).toEqual(["a"]);
  });

  it("after all windows nothing is next", () => {
    const p = pickWindows(items, parseDate("2026-05-01"));
    expect(ids(p.next)).toEqual([]);
    expect(p.nextStart).toBeUndefined();
    expect(ids(p.recent)).toEqual(["d"]);
  });
});

describe("vaccine windows 5 months", () => {
  const birth = parseDate("2026-05-28");
  const all = vaccineWindows(birth);

  it("dtap 3rd dose window", () => {
    const d = all.find((i) => i.id === "vac-dtap-3");
    expect(d).toBeDefined();
    expect(d && formatDate(d.start)).toBe("2026-11-28");
    expect(d && formatDate(d.end)).toBe("2026-12-27");
  });

  it("length equals dose and influenza items", () => {
    expect(all).toHaveLength(doseItems(birth).length + influenzaItems(birth).length);
  });

  it("picks current, recent and next windows on the reference date", () => {
    const p = pickWindows(all, today);
    expect(p.current).toHaveLength(0);
    expect(ids(p.recent)).toEqual(expect.arrayContaining(["vac-dtap-2", "vac-rota-rv1-2"]));
    expect(ids(p.next)).toEqual(expect.arrayContaining(["vac-dtap-3", "vac-hepb-3", "vac-flu-2026-2027"]));
    expect(p.nextStart && formatDate(p.nextStart)).toBe("2026-11-28");
    expect(p.imminent).toBe(false);
  });
});

describe("birth doses", () => {
  it("lists day-zero doses", () => {
    expect(birthDoses().map((d) => d.title)).toEqual(["BCG(결핵) 1차 (생후 4주 이내)", "B형간염 1차 (출생 시)"]);
  });
});

describe("checkup windows 5 months", () => {
  const birth = parseDate("2026-05-28");
  const groups = checkupWindows(birth);
  const infant = groups.find((g) => g.program === "infant");
  const oral = groups.find((g) => g.program === "oral");

  it("infant current and next", () => {
    expect(infant).toBeDefined();
    const p = pickWindows(infant?.items ?? [], today);
    expect(ids(p.current)).toEqual(["infant-checkup-2"]);
    expect(formatDate(p.current[0]?.start ?? today)).toBe("2026-09-28");
    expect(formatDate(p.current[0]?.end ?? today)).toBe("2026-12-27");
    expect(ids(p.next)).toEqual(["infant-checkup-3"]);
    expect(formatDate(p.next[0]?.start ?? today)).toBe("2027-02-28");
    expect(formatDate(p.next[0]?.end ?? today)).toBe("2027-06-27");
  });

  it("oral current and next", () => {
    const p = pickWindows(oral?.items ?? [], today);
    expect(ids(p.current)).toEqual([]);
    expect(ids(p.next)).toEqual(["oral-checkup-1"]);
  });

  it("window dates match checkupItems", () => {
    const byId = new Map(checkupItems(birth).map((i) => [i.id, i]));
    for (const g of groups) {
      for (const w of g.items) {
        const src = byId.get(w.id);
        expect(src).toBeDefined();
        expect(formatDate(w.start)).toBe(formatDate(src?.start ?? today));
        expect(formatDate(w.end)).toBe(formatDate(src?.end ?? today));
      }
    }
  });
});

describe("checkup round table", () => {
  it("lists rounds per program", () => {
    const table = checkupRoundTable();
    const infant = table.find((t) => t.label === "영유아 건강검진");
    const oral = table.find((t) => t.label === "영유아 구강검진");
    expect(infant?.rounds).toHaveLength(8);
    expect(infant?.rounds[0]).toBe("1차 생후 14~35일");
    expect(infant?.rounds[7]).toBe("8차 66~71개월");
    expect(oral?.rounds).toHaveLength(4);
    expect(oral?.rounds[3]).toBe("4차 54~65개월");
  });

  it("first infant round label", () => {
    expect(firstInfantRound().label).toBe("1차(생후 14~35일)");
  });
});
