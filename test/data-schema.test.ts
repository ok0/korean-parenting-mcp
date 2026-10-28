import { describe, expect, it } from "vitest";
import { PeriodRuleSchema, ProvenanceSchema, VACCINE_CODES } from "../src/data-store/schema.js";
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

describe("vaccinations real data", () => {
  it("loads vaccinations and resolves its basis ids", () => {
    expect(() => loadData("vaccinations")).not.toThrow();
    expect(() => resolveBasis(collectBasisIds(loadData("vaccinations")))).not.toThrow();
  });
});

describe("vaccination schedule", () => {
  const unitValue = (o: object): [string, number] => {
    const [key, value] = Object.entries(o as Record<string, number>)[0] ?? ["", 0];
    return [key.charAt(0), value];
  };

  it("matches the 2026 schedule table", () => {
    const rows = loadData("vaccinations").vaccines.flatMap((e) =>
      e.doses.map((d) => {
        const [unit, from] = unitValue(d.from);
        const [, to] = unitValue(d.to);
        return [e.id, d.dose, unit, from, to];
      }),
    );
    expect(rows).toEqual([
      ["bcg", 1, "d", 0, 28],
      ["hepb", 1, "d", 0, 0],
      ["hepb", 2, "m", 1, 1],
      ["hepb", 3, "m", 6, 6],
      ["dtap", 1, "m", 2, 2],
      ["dtap", 2, "m", 4, 4],
      ["dtap", 3, "m", 6, 6],
      ["dtap", 4, "m", 15, 18],
      ["dtap", 5, "y", 4, 6],
      ["dtap", 6, "y", 11, 12],
      ["ipv", 1, "m", 2, 2],
      ["ipv", 2, "m", 4, 4],
      ["ipv", 3, "m", 6, 18],
      ["ipv", 4, "y", 4, 6],
      ["hib", 1, "m", 2, 2],
      ["hib", 2, "m", 4, 4],
      ["hib", 3, "m", 6, 6],
      ["hib", 4, "m", 12, 15],
      ["pcv", 1, "m", 2, 2],
      ["pcv", 2, "m", 4, 4],
      ["pcv", 3, "m", 6, 6],
      ["pcv", 4, "m", 12, 15],
      ["rota-rv1", 1, "m", 2, 2],
      ["rota-rv1", 2, "m", 4, 4],
      ["rota-rv5", 1, "m", 2, 2],
      ["rota-rv5", 2, "m", 4, 4],
      ["rota-rv5", 3, "m", 6, 6],
      ["mmr", 1, "m", 12, 15],
      ["mmr", 2, "y", 4, 6],
      ["var", 1, "m", 12, 15],
      ["hepa", 1, "m", 12, 23],
      ["hepa", 2, "m", 12, 23],
      ["je-inactivated", 1, "m", 12, 23],
      ["je-inactivated", 2, "m", 12, 23],
      ["je-inactivated", 3, "m", 24, 35],
      ["je-inactivated", 4, "y", 6, 6],
      ["je-inactivated", 5, "y", 12, 12],
      ["je-live", 1, "m", 12, 23],
      ["je-live", 2, "m", 24, 35],
      ["hpv", 1, "y", 11, 12],
      ["hpv", 2, "y", 11, 12],
    ]);
    const vaccines = loadData("vaccinations").vaccines;
    expect(vaccines.find((v) => v.id === "dtap")?.doses[5]?.alias).toBe("Tdap/Td");
    expect(vaccines.find((v) => v.id === "hepb")?.doses[0]?.label).toBe("출생 시");
  });

  it("covers 13 vaccine kinds", () => {
    const vaccines = loadData("vaccinations").vaccines;
    expect(VACCINE_CODES.length).toBe(13);
    expect(new Set([...vaccines.map((v) => v.code), "flu"])).toEqual(new Set(VACCINE_CODES));
  });

  it("verification status", () => {
    const data = loadData("vaccinations");
    const unverified = new Set(["rota-rv1", "rota-rv5", "hpv"]);
    for (const v of data.vaccines) {
      expect(v.verified).toBe(unverified.has(v.id) ? "false" : "partial");
    }
    for (const s of data.influenza.seasons) {
      expect(s.verified).toBe("partial");
    }
  });

  it("influenza 2026-2027 season", () => {
    const seasons = loadData("vaccinations").influenza.seasons;
    expect(seasons).toHaveLength(1);
    expect(seasons[0]).toMatchObject({
      start: "2026-09-21",
      end: "2027-04-30",
      child_from_months: 6,
      child_max_age_years: 14,
      two_dose_under_years: 9,
      pregnant_doses: 1,
    });
  });

  it("new KDCA basis documents carry number and date", () => {
    const docs = loadData("basis-documents").documents;
    for (const id of ["kdca-schedule-2026", "kdca-guideline-2026", "kdca-nip-influenza"]) {
      const doc = docs.find((d) => d.id === id);
      expect(doc?.doc_no).toBeTruthy();
      expect(doc?.promulgated ?? doc?.amended ?? doc?.effective).toBeDefined();
    }
    const guideline = docs.find((d) => d.id === "kdca-guideline-2026");
    expect(guideline?.doc_no).toContain("309683");
    expect(guideline?.amended).toBe("2026-10-02");
    expect(docs.find((d) => d.id === "kdca-nip-influenza")?.amended).toBe("2026-08-25");
  });
});

describe("vaccinations validation failures", () => {
  type VaccFixture = {
    vaccines: {
      id: string;
      code: string;
      doses: { dose: number; from: Record<string, number>; to: Record<string, number> }[];
      basis_ids: string[];
      as_of: string;
    }[];
    influenza: { seasons: { start: string; end: string }[] };
  };
  const basis = loadData("basis-documents");
  const fixture = () => structuredClone(loadData("vaccinations")) as unknown as VaccFixture;
  const findVaccine = (x: VaccFixture, id: string) => x.vaccines.find((v) => v.id === id);

  it("rejects a missing vaccine kind", () => {
    const x = fixture();
    x.vaccines = x.vaccines.filter((v) => v.id !== "mmr");
    expect(() => validateDataset("vaccinations", x, basis)).toThrow(DataValidationError);
    expect(() => validateDataset("vaccinations", x, basis)).toThrow("누락");
    expect(() => validateDataset("vaccinations", x, basis)).toThrow("mmr");
  });

  it("rejects non-contiguous dose numbers", () => {
    const x = fixture();
    const dtap = findVaccine(x, "dtap");
    if (dtap) dtap.doses = dtap.doses.filter((d) => d.dose !== 3);
    expect(() => validateDataset("vaccinations", x, basis)).toThrow(DataValidationError);
    expect(() => validateDataset("vaccinations", x, basis)).toThrow("불연속");
  });

  it("rejects a dose whose to is before from", () => {
    const x = fixture();
    const dose = findVaccine(x, "dtap")?.doses.find((d) => d.dose === 4);
    if (dose) dose.to = { months: 14 };
    expect(() => validateDataset("vaccinations", x, basis)).toThrow(DataValidationError);
  });

  it("rejects a dose whose from and to units differ", () => {
    const x = fixture();
    const dose = findVaccine(x, "dtap")?.doses.find((d) => d.dose === 5);
    if (dose) dose.to = { months: 6 };
    expect(() => validateDataset("vaccinations", x, basis)).toThrow(DataValidationError);
  });

  it("rejects a vaccine with an unknown basis id", () => {
    const x = fixture();
    const hpv = findVaccine(x, "hpv");
    if (hpv) hpv.basis_ids = ["no-such-doc"];
    expect(() => validateDataset("vaccinations", x, basis)).toThrow(DataValidationError);
    expect(() => validateDataset("vaccinations", x, basis)).toThrow("no-such-doc");
  });

  it("rejects a malformed as_of", () => {
    const x = fixture();
    const bcg = findVaccine(x, "bcg");
    if (bcg) bcg.as_of = "2026/10/28";
    expect(() => validateDataset("vaccinations", x, basis)).toThrow(DataValidationError);
  });

  it("rejects a season whose end is before its start", () => {
    const x = fixture();
    const season = x.influenza.seasons[0];
    if (season) season.end = "2026-09-01";
    expect(() => validateDataset("vaccinations", x, basis)).toThrow(DataValidationError);
  });

  it("rejects influenza listed as a vaccine entry", () => {
    const x = fixture();
    const bcg = findVaccine(x, "bcg");
    if (bcg) x.vaccines.push({ ...structuredClone(bcg), id: "flu-x", code: "flu" });
    expect(() => validateDataset("vaccinations", x, basis)).toThrow(DataValidationError);
  });

  it("rejects an empty influenza season list", () => {
    const x = fixture();
    x.influenza.seasons = [];
    expect(() => validateDataset("vaccinations", x, basis)).toThrow(DataValidationError);
  });
});

describe("prenatal real data", () => {
  it("loads prenatal and resolves its basis ids", () => {
    expect(() => loadData("prenatal")).not.toThrow();
    expect(() => resolveBasis(collectBasisIds(loadData("prenatal")))).not.toThrow();
  });
});

describe("prenatal schedule", () => {
  it("prenatal intervals match annex 1", () => {
    const data = loadData("prenatal");
    expect(data.intervals).toEqual([
      { from_week: 0, to_week: 28, every_weeks: 4 },
      { from_week: 29, to_week: 36, every_weeks: 2 },
      { from_week: 37, to_week: null, every_weeks: 1 },
    ]);
    expect(data.high_risk_note).toContain("만 35세 이상");
    expect(data.high_risk_note).toContain("다태아");
    expect(data.verified).toBe("partial");
  });

  it("annex 1 basis records the press-release citation", () => {
    const doc = loadData("basis-documents").documents.find((d) => d.id === "mch-act-rule-annex1");
    expect(doc?.doc_no).toBeTruthy();
    expect(doc?.amended).toBe("2015-07-29");
    expect(doc?.note).toContain("2023-07-27");
  });
});

describe("prenatal validation failures", () => {
  type PrenatalFixture = {
    intervals: { from_week: number; to_week: number | null; every_weeks: number }[];
    basis_ids: string[];
    as_of: string;
  };
  const basis = loadData("basis-documents");
  const fixture = () => structuredClone(loadData("prenatal")) as unknown as PrenatalFixture;

  it("rejects two intervals instead of three", () => {
    const x = fixture();
    x.intervals.pop();
    expect(() => validateDataset("prenatal", x, basis)).toThrow(DataValidationError);
    expect(() => validateDataset("prenatal", x, basis)).toThrow("3개");
  });

  it("rejects a gap between intervals", () => {
    const x = fixture();
    const second = x.intervals[1];
    if (second) second.from_week = 30;
    expect(() => validateDataset("prenatal", x, basis)).toThrow(DataValidationError);
    expect(() => validateDataset("prenatal", x, basis)).toThrow("연속");
  });

  it("rejects a last interval that ends before the due date", () => {
    const x = fixture();
    const last = x.intervals[2];
    if (last) last.to_week = 40;
    expect(() => validateDataset("prenatal", x, basis)).toThrow(DataValidationError);
  });

  it("rejects an unknown basis id", () => {
    const x = fixture();
    x.basis_ids = ["no-such-doc"];
    expect(() => validateDataset("prenatal", x, basis)).toThrow(DataValidationError);
    expect(() => validateDataset("prenatal", x, basis)).toThrow("no-such-doc");
  });

  it("rejects a malformed as_of", () => {
    const x = fixture();
    x.as_of = "2026-1-1";
    expect(() => validateDataset("prenatal", x, basis)).toThrow(DataValidationError);
  });
});

describe("M5 real data", () => {
  it("loads benefits, leave and local guidance", () => {
    expect(() => loadData("benefits")).not.toThrow();
    expect(() => loadData("leave")).not.toThrow();
    expect(() => loadData("local-guidance")).not.toThrow();
  });

  it("lists child allowance versions by year with age limits", () => {
    const rows = loadData("benefits").child_allowance.versions.map((v) => [
      v.effective_from.slice(0, 4),
      v.age_under_years,
    ]);
    expect(rows).toEqual([
      ["2026", 9],
      ["2027", 10],
      ["2028", 11],
      ["2029", 12],
      ["2030", 13],
    ]);
  });

  it("sets the first meeting application period", () => {
    expect(loadData("benefits").first_meeting.versions[0]?.application_period).toEqual({
      unit: "month",
      amount: 24,
      countFirstDay: true,
      extendIfNonWorking: true,
    });
  });

  it("keeps the spouse leave versions adjacent with the new-law values", () => {
    const [oldV, neu] = loadData("leave").spouse_leave.versions;
    expect(oldV).toMatchObject({ effective_to: "2026-09-17" });
    expect(neu).toMatchObject({
      effective_from: "2026-09-18",
      paid_days: 20,
      split_max: 3,
      before_due_days: 50,
      after_birth_days: 120,
    });
  });

  it("does not mark maternity or parental leave as fully verified", () => {
    const leave = loadData("leave");
    expect(leave.maternity_leave.verified).not.toBe("full");
    expect(leave.parental_leave.verified).not.toBe("full");
  });

  it("gives each new basis document a number and a date", () => {
    const newIds = [
      "equal-employment-act",
      "labor-standards-act",
      "child-allowance-act",
      "child-allowance-mohw-2026-04",
      "first-meeting-gov24",
      "mohw-pregnancy-medical-cost",
      "easylaw-parental-leave-pay",
      "childcare-waitlist-portal",
    ];
    const docs = loadData("basis-documents").documents;
    for (const id of newIds) {
      const d = docs.find((x) => x.id === id);
      expect(d?.doc_no).toBeTruthy();
      expect(d?.promulgated ?? d?.amended ?? d?.effective).toBeTruthy();
    }
  });

  it("records the official law API keys and verification states", () => {
    const docs = loadData("basis-documents").documents;
    expect(docs.find((x) => x.id === "equal-employment-act")).toMatchObject({ law_api: { mst: "284457" } });
    expect(docs.find((x) => x.id === "labor-standards-act")).toMatchObject({ law_api: { mst: "285279" } });
    expect(docs.find((x) => x.id === "childcare-waitlist-portal")?.verified).toBe("false");
    expect(docs.find((x) => x.id === "easylaw-parental-leave-pay")?.note).toContain("법적 효력 없음");
  });
});

describe("benefits validation failures", () => {
  const basis = loadData("basis-documents");
  const fixture = () => structuredClone(loadData("benefits"));
  const expectFail = (x: unknown, message: string) => {
    expect(() => validateDataset("benefits", x, basis)).toThrow(DataValidationError);
    expect(() => validateDataset("benefits", x, basis)).toThrow(message);
  };

  it("rejects overlapping child allowance versions", () => {
    const x = fixture();
    const v0 = x.child_allowance.versions[0];
    if (v0) v0.effective_to = "2027-01-01";
    expectFail(x, "겹칩니다");
  });

  it("rejects a parent allowance version that ends before it starts", () => {
    const x = fixture();
    const v0 = x.parent_allowance.versions[0];
    if (v0) v0.effective_to = "2025-12-31";
    expectFail(x, "시작이 끝보다");
  });

  it("rejects a missing effective_to on a non-last version", () => {
    const x = fixture();
    const v0 = x.child_allowance.versions[0];
    if (v0) delete v0.effective_to;
    expectFail(x, "마지막 버전만");
  });

  it("rejects child allowance versions out of order", () => {
    const x = fixture();
    x.child_allowance.versions.reverse();
    expectFail(x, "오름차순");
  });

  it("rejects an unknown basis id in first meeting", () => {
    const x = fixture();
    const v0 = x.first_meeting.versions[0];
    if (v0) v0.basis_ids = ["no-such-doc"];
    expectFail(x, "no-such-doc");
  });

  it("rejects a malformed as_of in pregnancy medical cost", () => {
    const x = fixture();
    const v0 = x.pregnancy_medical.versions[0];
    if (v0) v0.as_of = "2026-1-1";
    expect(() => validateDataset("benefits", x, basis)).toThrow(DataValidationError);
  });
});

describe("leave / local guidance validation failures", () => {
  const basis = loadData("basis-documents");
  const leaveFixture = () => structuredClone(loadData("leave"));
  const localFixture = () => structuredClone(loadData("local-guidance"));

  it("rejects spouse leave versions that do not touch", () => {
    const x = leaveFixture();
    const neu = x.spouse_leave.versions[1];
    if (neu) neu.effective_from = "2026-09-19";
    expect(() => validateDataset("leave", x, basis)).toThrow(DataValidationError);
    expect(() => validateDataset("leave", x, basis)).toThrow("맞닿아야");
  });

  it("rejects a spouse leave list without two versions", () => {
    const x = leaveFixture();
    x.spouse_leave.versions.pop();
    expect(() => validateDataset("leave", x, basis)).toThrow(DataValidationError);
    expect(() => validateDataset("leave", x, basis)).toThrow("2개");
  });

  it("rejects an unknown basis id in parental leave", () => {
    const x = leaveFixture();
    x.parental_leave.basis_ids = ["no-such-doc"];
    expect(() => validateDataset("leave", x, basis)).toThrow(DataValidationError);
    expect(() => validateDataset("leave", x, basis)).toThrow("no-such-doc");
  });

  it("rejects a malformed as_of in maternity leave", () => {
    const x = leaveFixture();
    x.maternity_leave.as_of = "2026-1-1";
    expect(() => validateDataset("leave", x, basis)).toThrow(DataValidationError);
  });

  it("rejects local guidance without the daycare waitlist entry", () => {
    const x = localFixture();
    x.entries = x.entries.filter((e) => e.id !== "daycare-waitlist");
    expect(() => validateDataset("local-guidance", x, basis)).toThrow(DataValidationError);
    expect(() => validateDataset("local-guidance", x, basis)).toThrow("누락: daycare-waitlist");
  });

  it("rejects a local contact template without the region placeholder", () => {
    const x = localFixture();
    const first = x.entries[0];
    if (first) first.contact_template = "보건소에 확인";
    expect(() => validateDataset("local-guidance", x, basis)).toThrow(DataValidationError);
    expect(() => validateDataset("local-guidance", x, basis)).toThrow("{region}");
  });
});

describe("leave articles", () => {
  const basis = loadData("basis-documents");
  const topics = ["spouse_leave", "maternity_leave", "parental_leave"] as const;

  it("each article resolves to a law basis document", () => {
    const articles = loadData("leave").articles;
    for (const topic of topics) {
      const a = articles[topic];
      const api = resolveBasis(a.basis_ids)[0]?.law_api;
      expect(api?.kind).toBe("law");
      expect(api?.kind === "law" ? api.law_name : "").not.toBe("");
      expect(a.verified).not.toBe("full");
    }
  });

  it("article numbers agree with leave labels", () => {
    const leave = loadData("leave");
    const articles = leave.articles;
    expect(leave.maternity_leave.article_label).toContain(`제${articles.maternity_leave.article}조`);
    expect(leave.parental_leave.article_label).toContain(`제${articles.parental_leave.article}조`);
    expect(articles.spouse_leave.article === 18 && articles.spouse_leave.branch === 2).toBe(true);
  });

  it("rejects branch out of range", () => {
    const x = structuredClone(loadData("leave"));
    x.articles.spouse_leave.branch = 100;
    expect(() => validateDataset("leave", x, basis)).toThrow(DataValidationError);
  });

  it("law_api without comparison values is marked unconfirmed", () => {
    const docs = loadData("basis-documents").documents;
    const hasComparison = (api: NonNullable<(typeof docs)[number]["law_api"]>): boolean =>
      api.kind === "admrul"
        ? Boolean(api.serial || api.number)
        : api.kind === "licbyl"
          ? Boolean(api.promulgated || api.promulgation_no)
          : Boolean(api.mst || api.effective);
    const unconfirmed = docs.filter((d) => d.law_api !== null && !hasComparison(d.law_api));
    expect(unconfirmed.map((d) => d.id)).toContain("mch-act-rule-annex1");
    for (const d of unconfirmed) {
      expect(d.verified).not.toBe("full");
      expect(d.note).toMatch(/M11|미확인|미대조/);
    }
  });
});
