import { describe, expect, it } from "vitest";
import { callDataGoKr } from "../src/clients/data-go-kr.js";
import { SPECS } from "../src/clients/data-go-kr-specs.js";
import { CACHE_TTL_MS } from "../src/core/cache-ttl.js";
import { createTestContext } from "./helpers/context.js";

const TTL_VALUES: number[] = Object.values(CACHE_TTL_MS);

describe("data.go.kr dataset specs", () => {
  it("marks only live-confirmed specs as confirmed", () => {
    const confirmed = Object.values(SPECS)
      .filter((s) => s.confirmed)
      .map((s) => s.id);
    expect(confirmed).toEqual(["nemcList", "nemcMoonlight", "durPregnancy", "kasiHoliday"]);
  });

  it("pins nemcList endpoint and known params", () => {
    expect(SPECS.nemcList.baseUrl).toBe("https://apis.data.go.kr/B552657/HsptlAsembySearchService");
    expect(SPECS.nemcList.operation).toBe("getHsptlMdcncListInfoInqire");
    expect(SPECS.nemcList.knownParams).toEqual(expect.arrayContaining(["Q0", "Q1", "QD", "QN"]));
  });

  it("standard specs use the XML path (no formatParams)", () => {
    for (const s of Object.values(SPECS)) expect(s.formatParams).toBeUndefined();
  });

  it("confirmed specs have endpoint and no pending note", () => {
    for (const spec of Object.values(SPECS)) {
      if (!spec.confirmed) continue;
      expect(spec.baseUrl.trim()).not.toBe("");
      expect(spec.operation.trim()).not.toBe("");
      if (spec.note) expect(spec.note).not.toContain("/M11/");
    }
  });

  it("leaves out-of-scope specs untouched", () => {
    for (const id of ["vaccClinic", "checkupClinic"] as const) {
      expect(SPECS[id].confirmed).toBe(false);
      expect(SPECS[id].baseUrl).toBe("");
      expect(SPECS[id].operation).toBe("");
    }
  });

  it("keeps every spec consistent", () => {
    for (const [key, spec] of Object.entries(SPECS)) {
      expect(spec.id).toBe(key);
      expect(spec.attribution.trim()).not.toBe("");
      expect(spec.title.trim()).not.toBe("");
      if (!spec.confirmed) expect(spec.note).toBeTruthy();
      expect(TTL_VALUES).toContain(spec.cacheTtlMs);
    }
    expect(SPECS.nemcList.cacheTtlMs).toBe(0);
    expect(SPECS.nemcMoonlight.cacheTtlMs).toBe(0);
  });

  it("rejects an unconfirmed spec with INTERNAL and never calls fetch", async () => {
    const calls: string[] = [];
    const base = createTestContext({ env: { DATA_GO_KR_SERVICE_KEY: "test-key" } });
    const ctx = {
      ...base,
      fetch: async (href: string | URL | Request) => {
        calls.push(String(href));
        return new Response("", { status: 200 });
      },
    };
    await expect(callDataGoKr(SPECS.benefitsList, {}, ctx)).rejects.toMatchObject({ kind: "INTERNAL" });
    expect(calls).toHaveLength(0);
  });
});
