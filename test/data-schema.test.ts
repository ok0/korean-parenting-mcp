import { describe, expect, it } from "vitest";
import { PeriodRuleSchema, ProvenanceSchema } from "../src/data-store/schema.js";
import {
  collectBasisIds,
  DataValidationError,
  loadData,
  resolveBasis,
  validateDataset,
} from "../src/data-store/load.js";

const base = { basis_ids: ["holiday-regulation"], as_of: "2026-10-28", verified: "partial" };

describe("real data", () => {
  it("loads basis documents including holiday-regulation with mst 285779", () => {
    const doc = loadData("basis-documents").documents.find((d) => d.id === "holiday-regulation");
    expect(doc).toBeDefined();
    expect(doc).toMatchObject({ law_api: { mst: "285779" } });
  });

  it("loads holidays", () => {
    expect(() => loadData("holidays")).not.toThrow();
  });

  it("resolves every basis id used by holidays", () => {
    expect(() => resolveBasis(collectBasisIds(loadData("holidays")))).not.toThrow();
  });

  it("loads deadlines", () => {
    expect(() => loadData("deadlines")).not.toThrow();
  });

  it("loads checkups", () => {
    expect(() => loadData("checkups")).not.toThrow();
  });

  it("resolves every basis id used by deadlines and checkups", () => {
    expect(() => resolveBasis(collectBasisIds(loadData("deadlines")))).not.toThrow();
    expect(() => resolveBasis(collectBasisIds(loadData("checkups")))).not.toThrow();
  });
});

describe("checkup ranges match the published schedule", () => {
  it("maps every checkup to its published offsets", () => {
    const rows = loadData("checkups")
      .checkups.map((c) => {
        const from = "days" in c.from ? c.from.days : c.from.months;
        const to = "days" in c.to ? c.to.days : c.to.months;
        return [c.program, c.round, from, to];
      })
      .sort((a, b) => {
        const pa = String(a[0]);
        const pb = String(b[0]);
        if (pa !== pb) return pa < pb ? -1 : 1;
        return (a[1] as number) - (b[1] as number);
      });
    expect(rows).toEqual([
      ["infant", 1, 14, 35],
      ["infant", 2, 4, 6],
      ["infant", 3, 9, 12],
      ["infant", 4, 18, 24],
      ["infant", 5, 30, 36],
      ["infant", 6, 42, 48],
      ["infant", 7, 54, 60],
      ["infant", 8, 66, 71],
      ["oral", 1, 18, 29],
      ["oral", 2, 30, 41],
      ["oral", 3, 42, 53],
      ["oral", 4, 54, 65],
    ]);
  });

  it("uses days for infant round 1 and months for the rest", () => {
    const checkups = loadData("checkups").checkups;
    const first = checkups.find((c) => c.id === "infant-checkup-1");
    expect(first?.from).toEqual({ days: 14 });
    expect(first?.to).toEqual({ days: 35 });
  });
});

describe("deadlines rules", () => {
  it("birth registration is one month counted from the first day with extension", () => {
    const entry = loadData("deadlines").deadlines.find((d) => d.id === "birth-registration");
    expect(entry?.rule).toEqual({ unit: "month", amount: 1, countFirstDay: true, extendIfNonWorking: true });
  });

  it("parent and child allowance are 60-day items with extension", () => {
    const deadlines = loadData("deadlines").deadlines;
    for (const id of ["parent-allowance", "child-allowance"]) {
      const entry = deadlines.find((d) => d.id === id);
      expect(entry?.rule).toEqual({ unit: "day", amount: 60, countFirstDay: true, extendIfNonWorking: true });
    }
  });

  it("no deadline is marked fully verified", () => {
    for (const d of loadData("deadlines").deadlines) {
      expect(d.verified).not.toBe("full");
    }
  });
});

describe("deadlines/checkups validation failures", () => {
  const basis = loadData("basis-documents");

  it("rejects a deadline with an unknown basis id", () => {
    const x = structuredClone(loadData("deadlines")) as unknown as { deadlines: Record<string, unknown>[] };
    if (x.deadlines[0]) x.deadlines[0].basis_ids = ["no-such-doc"];
    expect(() => validateDataset("deadlines", x, basis)).toThrow(DataValidationError);
    expect(() => validateDataset("deadlines", x, basis)).toThrow("no-such-doc");
  });

  it("rejects a deadline with a malformed as_of", () => {
    const x = structuredClone(loadData("deadlines")) as unknown as { deadlines: Record<string, unknown>[] };
    if (x.deadlines[0]) x.deadlines[0].as_of = "2026/10/28";
    expect(() => validateDataset("deadlines", x, basis)).toThrow(DataValidationError);
  });

  it("rejects checkups missing infant round 8", () => {
    const x = structuredClone(loadData("checkups")) as unknown as { checkups: { id: string }[] };
    x.checkups = x.checkups.filter((c) => c.id !== "infant-checkup-8");
    expect(() => validateDataset("checkups", x, basis)).toThrow(DataValidationError);
    expect(() => validateDataset("checkups", x, basis)).toThrow("infant 회차");
  });

  it("rejects checkups missing oral round 4", () => {
    const x = structuredClone(loadData("checkups")) as unknown as { checkups: { id: string }[] };
    x.checkups = x.checkups.filter((c) => c.id !== "oral-checkup-4");
    expect(() => validateDataset("checkups", x, basis)).toThrow(DataValidationError);
    expect(() => validateDataset("checkups", x, basis)).toThrow("oral 회차");
  });

  it("rejects a checkup whose to is before from", () => {
    const x = structuredClone(loadData("checkups")) as unknown as { checkups: Record<string, unknown>[] };
    if (x.checkups[0]) x.checkups[0].to = { days: 10 };
    expect(() => validateDataset("checkups", x, basis)).toThrow(DataValidationError);
  });

  it("rejects a checkup whose from and to units differ", () => {
    const x = structuredClone(loadData("checkups")) as unknown as { checkups: Record<string, unknown>[] };
    if (x.checkups[0]) x.checkups[0].to = { months: 1 };
    expect(() => validateDataset("checkups", x, basis)).toThrow(DataValidationError);
  });
});

describe("ProvenanceSchema", () => {
  it("accepts the base fixture", () => {
    expect(ProvenanceSchema.safeParse(base).success).toBe(true);
  });

  it("rejects empty basis_ids", () => {
    expect(ProvenanceSchema.safeParse({ ...base, basis_ids: [] }).success).toBe(false);
  });

  it("rejects a slash-separated as_of", () => {
    expect(ProvenanceSchema.safeParse({ ...base, as_of: "2026/10/28" }).success).toBe(false);
  });

  it("rejects a non-existent as_of date", () => {
    expect(ProvenanceSchema.safeParse({ ...base, as_of: "2026-02-30" }).success).toBe(false);
  });

  it("rejects an unknown verified value", () => {
    expect(ProvenanceSchema.safeParse({ ...base, verified: "yes" }).success).toBe(false);
  });

  it("rejects full without verifier and date", () => {
    expect(ProvenanceSchema.safeParse({ ...base, verified: "full" }).success).toBe(false);
  });

  it("rejects full without verification date", () => {
    expect(ProvenanceSchema.safeParse({ ...base, verified: "full", verified_by: "ok0" }).success).toBe(false);
  });

  it("accepts full with verifier and date", () => {
    expect(
      ProvenanceSchema.safeParse({ ...base, verified: "full", verified_by: "ok0", verified_on: "2026-10-28" }).success,
    ).toBe(true);
  });
});

describe("basis-documents validation failures", () => {
  it("rejects a document without doc_no", () => {
    const x = structuredClone(loadData("basis-documents")) as unknown as { documents: Record<string, unknown>[] };
    delete x.documents[0]?.doc_no;
    expect(() => validateDataset("basis-documents", x)).toThrow(DataValidationError);
  });

  it("rejects a document without any promulgation, amendment or effective date", () => {
    const x = structuredClone(loadData("basis-documents")) as unknown as { documents: Record<string, unknown>[] };
    const first = x.documents[0];
    delete first?.promulgated;
    delete first?.amended;
    delete first?.effective;
    expect(() => validateDataset("basis-documents", x)).toThrow(DataValidationError);
  });

  it("rejects duplicate document ids", () => {
    const x = structuredClone(loadData("basis-documents")) as unknown as { documents: Record<string, unknown>[] };
    const second = x.documents[1];
    if (second) second.id = x.documents[0]?.id;
    expect(() => validateDataset("basis-documents", x)).toThrow(DataValidationError);
  });
});

describe("holidays validation failures", () => {
  const basis = loadData("basis-documents");

  it("rejects an unknown basis id", () => {
    const x = structuredClone(loadData("holidays")) as unknown as { basis_ids: string[] };
    x.basis_ids = ["no-such-doc"];
    expect(() => validateDataset("holidays", x, basis)).toThrow(DataValidationError);
    expect(() => validateDataset("holidays", x, basis)).toThrow("no-such-doc");
  });

  it("rejects a malformed holiday date", () => {
    const x = structuredClone(loadData("holidays")) as unknown as {
      years: Record<string, { date: string; name: string }[]>;
    };
    const entry = x.years["2026"]?.[0];
    if (entry) entry.date = "2026-1-1";
    expect(() => validateDataset("holidays", x, basis)).toThrow(DataValidationError);
  });

  it("rejects a covered year that misses a fixed holiday", () => {
    const x = structuredClone(loadData("holidays")) as unknown as {
      years: Record<string, { date: string; name: string }[]>;
    };
    x.years["2026"] = (x.years["2026"] ?? []).filter((e) => e.date !== "2026-05-01");
    let caught: unknown;
    try {
      validateDataset("holidays", x, basis);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DataValidationError);
    expect(String((caught as Error).message)).toContain("2026-05-01");
  });

  it("requires basis documents when none are supplied", () => {
    expect(() => validateDataset("holidays", loadData("holidays"))).toThrow("근거 문서 목록");
  });
});

describe("PeriodRuleSchema", () => {
  it("accepts a valid rule", () => {
    expect(
      PeriodRuleSchema.safeParse({ unit: "month", amount: 1, countFirstDay: true, extendIfNonWorking: true }).success,
    ).toBe(true);
  });

  it("rejects amount 0", () => {
    expect(
      PeriodRuleSchema.safeParse({ unit: "month", amount: 0, countFirstDay: true, extendIfNonWorking: true }).success,
    ).toBe(false);
  });

  it("rejects unit week", () => {
    expect(
      PeriodRuleSchema.safeParse({ unit: "week", amount: 1, countFirstDay: true, extendIfNonWorking: true }).success,
    ).toBe(false);
  });
});
