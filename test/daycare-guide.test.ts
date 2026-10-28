import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseDate } from "../src/date/civil-date.js";
import { DataValidationError, loadData, validateDataset } from "../src/data-store/load.js";
import { DAYCARE_LINK_IDS } from "../src/data-store/schema.js";
import { ageInMonths, daycareStage, guideContent, staticLinkProvider } from "../src/daycare/guide.js";

function raw(): any {
  return structuredClone(loadData("daycare-guide"));
}

function rejects(x: unknown): string {
  try {
    validateDataset("daycare-guide", x, loadData("basis-documents"));
  } catch (err) {
    if (err instanceof DataValidationError) return err.message;
    throw err;
  }
  throw new Error("validation did not fail");
}

describe("daycare guide dataset", () => {
  it("dataset loads with links ids, provenance and unverified region param", () => {
    const data = loadData("daycare-guide");
    expect(data.links.map((l) => l.id).sort()).toEqual([...DAYCARE_LINK_IDS].sort());
    for (const l of data.links) {
      expect(l.as_of).toBeTruthy();
      expect(l.source).toBeTruthy();
      expect(l.verified).toBeTruthy();
      expect(l.region_param).toBe("unverified");
    }
  });

  it("schema rejects broken data", () => {
    const missing = raw();
    missing.links.splice(missing.links.findIndex((l: { id: string }) => l.id === "info-search"), 1);
    expect(rejects(missing)).toContain("링크 누락");

    const query = raw();
    const waitlist = query.links.find((l: { id: string }) => l.id === "childcare-waitlist");
    waitlist.url += "&sido=11";
    expect(rejects(query)).toContain("미확인 쿼리 금지");

    const placeholder = raw();
    placeholder.region_steps.with_region = placeholder.region_steps.with_region.replace("{sigungu}", "");
    expect(rejects(placeholder)).toContain("자리표시자");

    const verified = raw();
    verified.waitlist.verified = "full";
    expect(() => validateDataset("daycare-guide", verified, loadData("basis-documents"))).toThrow(DataValidationError);

    const types = raw();
    types.comparison.types = types.comparison.types.filter((t: { id: string }) => t.id !== "home");
    expect(rejects(types)).toContain("유형 누락");
  });

  it("link urls are the researched ones", () => {
    const data = loadData("daycare-guide");
    const byId = (id: string) => data.links.find((l) => l.id === id)!;
    expect(byId("info-search").url.endsWith("info.childcare.go.kr/info/pnis/search/NurseryNameSlL.jsp")).toBe(true);
    expect([...new URL(byId("childcare-search").url).searchParams.keys()]).toEqual(["menuno"]);
    expect(new URL(byId("childcare-search").url).searchParams.get("menuno")).toBe("166");
    expect([...new URL(byId("childcare-waitlist").url).searchParams.keys()]).toEqual(["menuno"]);
    expect(new URL(byId("childcare-waitlist").url).searchParams.get("menuno")).toBe("176");
  });

  it("staticLinkProvider filters by stage", () => {
    const ids = (stage: Parameters<typeof staticLinkProvider.links>[0]["stage"]) =>
      staticLinkProvider.links({ stage }).map((l) => l.id);
    expect(ids("m0_11")).not.toContain("kindergarten-root");
    expect(ids("m0_11")).toHaveLength(4);
    expect(ids("m12_23")).toHaveLength(4);
    expect(ids("age3plus")).toHaveLength(5);
    expect(ids("general")).toHaveLength(5);
  });

  it("guideContent excludes links", () => {
    expect("links" in guideContent()).toBe(false);
  });

  it("no network in daycare module", () => {
    const src = readFileSync(new URL("../src/daycare/guide.ts", import.meta.url), "utf8");
    expect(src).not.toContain("fetch");
    expect(src).not.toContain("http:");
    expect(src).not.toContain("httpGet");
  });
});

describe("ageInMonths", () => {
  it.each([
    ["2026-05-28", "2026-10-28", 5],
    ["2025-08-28", "2026-10-28", 14],
    ["2025-08-29", "2026-10-28", 13],
    ["2026-01-31", "2026-02-28", 1],
    ["2026-01-31", "2026-02-27", 0],
    ["2024-02-29", "2025-02-28", 12],
    ["2025-10-29", "2026-10-28", 11],
  ])("birth %s today %s -> %d", (birth, today, expected) => {
    expect(ageInMonths(parseDate(birth), parseDate(today))).toBe(expected);
  });
});

describe("daycareStage", () => {
  const today = parseDate("2026-10-28");

  it("pregnancy from due date in future", () => {
    expect(daycareStage({ due: parseDate("2027-03-15") }, today)).toEqual({ ok: true, stage: "pregnancy" });
  });

  it("rejects due date in past", () => {
    const r = daycareStage({ due: parseDate("2026-10-01") }, today);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("due_date");
  });

  it("classifies by age in months", () => {
    expect(daycareStage({ birth: parseDate("2026-05-28") }, today)).toEqual({ ok: true, stage: "m0_11", months: 5 });
    expect(daycareStage({ birth: parseDate("2025-08-28") }, today)).toEqual({ ok: true, stage: "m12_23", months: 14 });
    expect(daycareStage({ birth: parseDate("2024-10-28") }, today)).toEqual({ ok: true, stage: "m24_35", months: 24 });
    expect(daycareStage({ birth: parseDate("2023-10-28") }, today)).toEqual({
      ok: true,
      stage: "age3plus",
      months: 36,
    });
  });

  it("rejects birth date in future", () => {
    const r = daycareStage({ birth: parseDate("2026-11-01") }, today);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("birth_date");
  });

  it("general without input", () => {
    expect(daycareStage({}, today)).toEqual({ ok: true, stage: "general" });
  });
});
