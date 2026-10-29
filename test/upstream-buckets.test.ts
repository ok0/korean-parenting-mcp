import { describe, expect, it } from "vitest";
import { SPECS, type SpecId } from "../src/clients/data-go-kr-specs.js";
import { dataGoKrCacheKey } from "../src/clients/data-go-kr.js";
import { LAW_BASE } from "../src/clients/law.js";
import { KG_BASE_URL, kindergartenCacheKey } from "../src/clients/kindergarten.js";
import { SK_BASE_URL, SK_SPECS, safetyKoreaCacheKey, type SkService } from "../src/clients/safetykorea.js";
import {
  bucketOfCacheKey,
  bucketOfUrl,
  createUpstreamGuard,
  defaultQuotaConfig,
  UPSTREAM_BUCKETS,
  type UpstreamBucket,
} from "../src/core/upstream-guard.js";

const CONFIRMED: ReadonlyArray<readonly [SpecId, UpstreamBucket]> = [
  ["nemcList", "nemcList"],
  ["nemcMoonlight", "nemcMoonlight"],
  ["benefitsList", "benefits"],
  ["durPregnancy", "dur"],
  ["kasiHoliday", "kasi"],
];

describe("confirmed specs classify by URL and key", () => {
  it.each(CONFIRMED)("%s → %s", (specId, bucket) => {
    const spec = SPECS[specId];
    expect(bucketOfUrl(new URL(`${spec.baseUrl}/${spec.operation}`))).toBe(bucket);
    expect(bucketOfCacheKey(dataGoKrCacheKey(spec, { a: 1 }))).toBe(bucket);
  });

  it("benefits slim key classifies as benefits", () => {
    expect(bucketOfCacheKey(dataGoKrCacheKey(SPECS.benefitsList, { page: 1, perPage: 1000 }) + "#slim")).toBe("benefits");
  });
});

describe("spec coverage", () => {
  it("every SPECS entry is either confirmed+classified or a placeholder without URL", () => {
    for (const spec of Object.values(SPECS)) {
      if (spec.baseUrl !== "") {
        expect(spec.confirmed).toBe(true);
        const pair = CONFIRMED.find(([id]) => SPECS[id].id === spec.id);
        expect(pair).toBeDefined();
        expect(bucketOfUrl(new URL(`${spec.baseUrl}/${spec.operation}`))).toBe(pair?.[1]);
      } else {
        expect(spec.operation).toBe("");
        expect(spec.confirmed).toBe(false);
      }
    }
  });
});

describe("client hosts", () => {
  it("law client", () => {
    expect(bucketOfUrl(new URL("lawSearch.do", LAW_BASE))).toBe("law");
    expect(bucketOfCacheKey("law:lawSearch.do?query=x")).toBe("law");
  });

  it("kindergarten client", () => {
    expect(bucketOfUrl(new URL(KG_BASE_URL))).toBe("kindergarten");
    expect(bucketOfCacheKey(kindergartenCacheKey({ sidoCode: "11", sggCode: "11200" }))).toBe("kindergarten");
  });

  it("safetykorea client", () => {
    for (const s of Object.keys(SK_SPECS) as SkService[]) {
      expect(bucketOfUrl(new URL(`${SK_BASE_URL}/${SK_SPECS[s].path}`))).toBe("safetykorea");
      expect(bucketOfCacheKey(safetyKoreaCacheKey(s, "k", "v"))).toBe("safetykorea");
    }
  });

  it("kasi live cache key", () => {
    expect(bucketOfCacheKey("kasi-live:2026")).toBe("kasi");
  });
});

describe("remote min TTL", () => {
  it("is positive for every bucket and key", () => {
    const g = createUpstreamGuard(defaultQuotaConfig());
    const cfg = defaultQuotaConfig();
    for (const b of UPSTREAM_BUCKETS) expect(cfg.minTtlMs[b]).toBeGreaterThan(0);
    for (const [specId] of CONFIRMED) {
      const spec = SPECS[specId];
      expect(Math.max(spec.cacheTtlMs, g.minTtl(dataGoKrCacheKey(spec, {})))).toBeGreaterThan(0);
    }
    expect(g.minTtl(dataGoKrCacheKey(SPECS.nemcList, {}))).toBe(1_800_000);
    expect(g.minTtl(dataGoKrCacheKey(SPECS.nemcMoonlight, {}))).toBe(1_800_000);
    const samples = [
      "law:lawSearch.do?query=x",
      kindergartenCacheKey({ sidoCode: "11", sggCode: "11200" }),
      safetyKoreaCacheKey("recallList", "k", "v"),
      "kasi-live:2026",
    ];
    for (const k of samples) expect(g.minTtl(k)).toBeGreaterThan(0);
  });

  it("local spec TTL unchanged for NEMC", () => {
    expect(SPECS.nemcList.cacheTtlMs).toBe(0);
    expect(SPECS.nemcMoonlight.cacheTtlMs).toBe(0);
  });
});
