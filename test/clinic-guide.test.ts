import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { clinicGuideContent, staticCheckupLinkProvider, staticVaccinationLinkProvider } from "../src/clinic/guide.js";
import { DataValidationError, loadData, validateDataset } from "../src/data-store/load.js";
import { OBSERVED_CLINIC_URLS } from "./helpers/clinic-urls.js";

function raw(): any {
  return structuredClone(loadData("clinic-guide"));
}

function rejects(x: unknown): string {
  try {
    validateDataset("clinic-guide", x, loadData("basis-documents"));
  } catch (err) {
    if (err instanceof DataValidationError) return err.message;
    throw err;
  }
  throw new Error("validation did not fail");
}

describe("clinic guide dataset", () => {
  it("dataset loads with link ids, provenance and unverified region param", () => {
    const data = loadData("clinic-guide");
    expect(data.vaccination.links.map((l) => l.id)).toEqual(["nip-clinic-search", "nip-schedule", "nip-root"]);
    expect(data.checkup.links.map((l) => l.id)).toEqual(["healthin-checkup-search", "nhis-root"]);
    for (const tool of ["vaccination", "checkup"] as const) {
      for (const l of data[tool].links) {
        expect(l.source).toBeTruthy();
        expect(l.as_of).toBeTruthy();
        expect(l.verified).toBeTruthy();
        expect(l.region_param).toBe("unverified");
      }
    }
  });

  it("urls are the observed ones", () => {
    const data = loadData("clinic-guide");
    for (const tool of ["vaccination", "checkup"] as const) {
      const urls = data[tool].links.flatMap((l) => (l.url !== undefined ? [l.url] : [])).sort();
      expect(urls).toEqual([...OBSERVED_CLINIC_URLS[tool]].sort());
    }
    const healthin = data.checkup.links.find((l) => l.id === "healthin-checkup-search");
    expect(healthin?.url).toBeUndefined();
    expect(healthin?.menu_path).toContain("건강iN");
    expect(healthin?.menu_path).toContain("영유아 탭");
  });

  it("schema rejects broken data", () => {
    const duplicate = raw();
    duplicate.vaccination.links[2] = structuredClone(duplicate.vaccination.links[0]);
    expect(rejects(duplicate)).toContain("중복 링크 id");

    const both = raw();
    const healthin = both.checkup.links.find((l: { id: string }) => l.id === "healthin-checkup-search");
    healthin.url = "https://www.nhis.or.kr/";
    expect(rejects(both)).toContain("하나만 필요합니다");

    const query = raw();
    const search = query.vaccination.links.find((l: { id: string }) => l.id === "nip-clinic-search");
    search.url += "&sido=11";
    expect(rejects(query)).toContain("미확인 쿼리 금지");

    const scheme = raw();
    const root = scheme.vaccination.links.find((l: { id: string }) => l.id === "nip-root");
    root.url = "http" + "://nip.kdca.go.kr";
    expect(rejects(scheme)).toContain("https 주소만 허용");

    const placeholder = raw();
    placeholder.vaccination.region_steps.with_region = placeholder.vaccination.region_steps.with_region.replace("{sigungu}", "");
    expect(rejects(placeholder)).toContain("자리표시자");

    const birth = raw();
    birth.checkup.stage_text.due_lines = ["출생 후 안내"];
    expect(rejects(birth)).toContain("{birth_items} 자리표시자");

    const verified = raw();
    verified.checkup.links[1].verified = "full";
    expect(() => validateDataset("clinic-guide", verified, loadData("basis-documents"))).toThrow(DataValidationError);
  });

  it("static providers return the tool links and guide content omits links", () => {
    expect(staticVaccinationLinkProvider.links({ stage: "none" })).toHaveLength(3);
    expect(staticCheckupLinkProvider.links({ stage: "birth", months: 5 })).toHaveLength(2);
    expect("links" in clinicGuideContent("vaccination").guide).toBe(false);
    expect(clinicGuideContent("checkup").as_of).toBe("2026-10-28");
  });

  it("no network in clinic modules", () => {
    for (const file of ["../src/clinic/guide.ts", "../src/clinic/stage.ts"]) {
      const src = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(src).not.toContain("fetch");
      expect(src).not.toContain("http:");
      expect(src).not.toContain("httpGet");
    }
  });
});
