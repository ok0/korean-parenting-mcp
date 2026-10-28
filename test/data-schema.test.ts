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
