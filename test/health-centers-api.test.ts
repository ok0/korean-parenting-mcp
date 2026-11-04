import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadData } from "../src/data-store/load.js";
import { HealthCentersSchema } from "../src/data-store/schema.js";
import { normalizeRegion } from "../src/region/normalize.js";
import { main } from "../scripts/build-health-centers.js";
import {
  API_FILE_NAME,
  ApiPageError,
  apiItemsToSourceRows,
  parseApiPage,
} from "../scripts/lib/health-centers-api.js";
import {
  buildHealthCenters,
  HeaderError,
  matchRegion,
  type RegionLookup,
  type SourceRow,
} from "../scripts/lib/health-centers-csv.js";
import type { ScriptIO } from "../scripts/lib/script-io.js";

const fixtureUrl = (name: string): URL => new URL(`./fixtures/health-centers/${name}`, import.meta.url);
const readFixture = (name: string): string => readFileSync(fixtureUrl(name), "utf8");
const apiDir = fileURLToPath(new URL("./fixtures/health-centers/api/", import.meta.url));
const page1 = readFixture("api/page-0001.json");
const page2 = readFixture("api/page-0002.json");
const dirs: string[] = [];

const regions = loadData("regions");
const lookup: RegionLookup = { normalize: normalizeRegion, sido: regions.sido, sigungu: regions.sigungu };

const code = (name: string): string => {
  const r = normalizeRegion(name);
  if (!r.ok || r.region.code === undefined) throw new Error(`지역 코드 계산 실패: ${name}`);
  return r.region.code;
};

const sejongCode = (): string => {
  const sido = lookup.sido.find((s) => s.name === "세종특별자치시");
  const sejong = lookup.sigungu.filter((g) => g.sido_code === sido?.code);
  if (sejong.length !== 1 || !sejong[0]) throw new Error("세종 시군구가 하나가 아니에요");
  return sejong[0].code;
};

const at = (rows: readonly SourceRow[], i: number): SourceRow => {
  const row = rows[i];
  if (!row) throw new Error(`행 없음: ${i}`);
  return row;
};

const wrap = (body: unknown): string => JSON.stringify({ response: { header: { resultCode: "00", resultMsg: "OK" }, body } });

const makeIo = (env: Record<string, string | undefined> = {}) => {
  const out: string[] = [];
  const err: string[] = [];
  const io: ScriptIO = {
    env,
    fetch: () => {
      throw new Error("global fetch disabled");
    },
    now: () => new Date("2026-11-03T00:00:00Z"),
    stdout: (t) => out.push(t),
    stderr: (t) => err.push(t),
  };
  return { io, out, err };
};

const stageDir = (manifest: Record<string, unknown> | null): string => {
  const dir = mkdtempSync(join(tmpdir(), "hca-"));
  dirs.push(dir);
  copyFileSync(fixtureUrl("api/page-0001.json"), join(dir, "page-0001.json"));
  copyFileSync(fixtureUrl("api/page-0002.json"), join(dir, "page-0002.json"));
  if (manifest !== null) {
    const base = JSON.parse(readFixture("api/manifest.json")) as Record<string, unknown>;
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ ...base, ...manifest }));
  }
  return dir;
};

beforeAll(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error("global fetch disabled");
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("health center API page conversion", () => {
  it("parses a page", () => {
    const p = parseApiPage(page1);
    expect(p.resultCode).toBe("00");
    expect(p.totalCount).toBe(3);
    expect(p.pageNo).toBe(1);
    expect(p.items).toHaveLength(2);
  });

  it("accepts items.item shapes and empty items", () => {
    const item = { htInstNm: "가", ctpvNm: "경기도", sggNm: "수원시", htctTypeNm: "보건소" };
    expect(parseApiPage(wrap({ items: { item: [item] }, totalCount: "1" })).items).toHaveLength(1);
    expect(parseApiPage(wrap({ items: { item }, totalCount: "1" })).items).toHaveLength(1);
    expect(parseApiPage(wrap({ items: "", totalCount: "0" })).items).toHaveLength(0);
    const bare = parseApiPage(JSON.stringify({ header: { resultCode: "00", resultMsg: "OK" }, body: { items: { item: [item] }, numOfRows: 10, pageNo: 1, totalCount: 1 } }));
    expect(bare.items).toHaveLength(1);
    expect(bare.totalCount).toBe(1);
    let shape: unknown;
    try {
      parseApiPage("{}");
    } catch (e) {
      shape = e;
    }
    expect(shape).toBeInstanceOf(ApiPageError);
    expect((shape as ApiPageError).code).toBe("SHAPE");
    expect((shape as ApiPageError).message).toContain("header");
  });

  it("maps result codes", () => {
    expect(parseApiPage(JSON.stringify({ response: { header: { resultCode: "03", resultMsg: "NODATA" } } }))).toMatchObject({
      items: [],
      totalCount: 0,
    });

    let quota: unknown;
    try {
      parseApiPage(readFixture("api-error-22.json"));
    } catch (e) {
      quota = e;
    }
    expect(quota).toBeInstanceOf(ApiPageError);
    expect((quota as ApiPageError).code).toBe("22");
    expect((quota as ApiPageError).message).toContain("한도");

    let gateway: unknown;
    try {
      parseApiPage(readFixture("api-gateway-error.xml"));
    } catch (e) {
      gateway = e;
    }
    expect(gateway).toBeInstanceOf(ApiPageError);
    expect((gateway as ApiPageError).code).toBe("30");
    expect((gateway as ApiPageError).message).toContain("SERVICE_KEY_IS_NOT_REGISTERED_ERROR");

    let parse: unknown;
    try {
      parseApiPage("not json");
    } catch (e) {
      parse = e;
    }
    expect(parse).toBeInstanceOf(ApiPageError);
    expect((parse as ApiPageError).code).toBe("PARSE");
  });

  it("maps API fields to source rows", () => {
    const rows = apiItemsToSourceRows(parseApiPage(page1).items);
    expect(rows.map((r) => r.row)).toEqual([1, 2]);
    const second = at(rows, 1);
    expect(second.sigungu).toBe("수원시 영통구");
    expect(second.phone).toBe("1666-0000");
    expect(second.dataDate).toBe("2026-10-15");

    const [head, ...rest] = parseApiPage(page1).items;
    if (!head) throw new Error("항목 없음");
    const headWithoutSgg: Record<string, unknown> = { ...head };
    delete headWithoutSgg.sggNm;
    let headerError: unknown;
    try {
      apiItemsToSourceRows([headWithoutSgg, ...rest]);
    } catch (e) {
      headerError = e;
    }
    expect(headerError).toBeInstanceOf(HeaderError);
    expect((headerError as HeaderError).missing).toEqual(["sggNm"]);
  });

  it("matches Sejong rows with 없음 and empty sigungu", () => {
    const rows = apiItemsToSourceRows(parseApiPage(page1).items);
    const i1 = at(rows, 0);
    expect(matchRegion(i1, lookup)).toEqual({ code: sejongCode() });
    expect(matchRegion({ ...i1, sigungu: "" }, lookup)).toEqual({ code: sejongCode() });
    const seoul = matchRegion({ ...i1, sido: "서울특별시", sigungu: "없음" }, lookup);
    expect(seoul).toHaveProperty("unmatched");
    expect((seoul as { unmatched: string }).unmatched).toContain("'없음'");
  });

  it("matches city plus general-gu sigungu", () => {
    const rows = apiItemsToSourceRows(parseApiPage(page1).items);
    expect(matchRegion(at(rows, 1), lookup)).toEqual({ code: code("경기도 수원시 영통구") });
  });

  it("builds from API pages", () => {
    const rows = [...apiItemsToSourceRows(parseApiPage(page1).items), ...apiItemsToSourceRows(parseApiPage(page2).items)];
    const { data, report } = buildHealthCenters(rows, undefined, {
      lookup,
      sourceModified: "2026-11-02",
      asOf: "2026-11-02",
      generatedAt: "2026-11-03",
      fileName: API_FILE_NAME,
    });
    expect(data.counts).toEqual({ source_rows: 3, kept: 2, unmatched: 0 });
    const sejong = sejongCode();
    const yeongtong = code("경기도 수원시 영통구");
    const codes = data.centers.map((c) => c.code);
    expect(codes).toContain(sejong);
    expect(codes).toContain(yeongtong);
    expect(data.centers.some((c) => c.name === "가상조치원보건지소")).toBe(false);

    const yt = data.centers.find((c) => c.code === yeongtong);
    expect(yt?.phone).toBe("1666-0000");
    expect(yt?.homepage).toBeUndefined();
    expect(yt?.address).toBe("경기도 수원시 영통구 가상로 2 (가상동, 가상영통구보건소)");

    const sj = data.centers.find((c) => c.code === sejong);
    expect(sj?.phone).toBeUndefined();
    expect(sj?.source_date).toBe("2026-09-30");

    expect(report.fieldIssues).toHaveLength(1);
    expect(report.fieldIssues[0]).toContain("홈페이지 주소 형식");
    expect(report.dataDateRange).toEqual({ min: "2026-09-30", max: "2026-10-15" });
    expect(report.coverage.units).toBe(lookup.sigungu.length);
    expect(report.coverage.covered).toBe(3);
    expect(report.coverage.missing).toHaveLength(lookup.sigungu.length - 3);
    expect(report.coverage.missing).toContain(`경기도 수원시 장안구(${code("경기도 수원시 장안구")})`);
    expect(report.coverage.missing.some((m) => m.endsWith(`(${code("경기도 수원시 영통구")})`))).toBe(false);
    expect(HealthCentersSchema.safeParse(data).success).toBe(true);
  });

  it("CLI builds from an API page directory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hca-cli-"));
    dirs.push(dir);
    const out = join(dir, "hc.json");

    const checkRun = makeIo();
    expect(await main(["--input", apiDir, "--source-modified", "2026-11-02", "--out", out, "--check"], checkRun.io, { corrections: [] })).toBe(10);
    expect(existsSync(out)).toBe(false);
    const text = checkRun.out.join("");
    expect(text).toContain("원본 행: 3");
    expect(text).toContain("미일치: 0");
    expect(text).toContain("데이터기준일자: 2026-09-30 ~ 2026-10-15");
    expect(text).toContain(`주 기관 지역: 3/${lookup.sigungu.length}`);
    expect(text).toContain("주 기관을 찾지 못한 지역:");

    const saveRun = makeIo();
    expect(await main(["--input", apiDir, "--source-modified", "2026-11-02", "--out", out], saveRun.io, { corrections: [] })).toBe(0);
    const saved = JSON.parse(readFileSync(out, "utf8")) as { source: { file_name: string } };
    expect(saved.source.file_name).toBe("tn_pubr_public_ht_inst_api");

    const recheck = makeIo();
    expect(await main(["--input", apiDir, "--source-modified", "2026-11-02", "--out", out, "--check"], recheck.io, { corrections: [] })).toBe(0);
  });

  it("CLI rejects incomplete API directories", async () => {
    const noManifest = stageDir(null);
    const noManifestRun = makeIo();
    expect(await main(["--input", noManifest, "--source-modified", "2026-11-02"], noManifestRun.io)).toBe(2);
    expect(noManifestRun.err.join("")).toContain("manifest.json");

    const incomplete = stageDir({ complete: false });
    const incompleteRun = makeIo();
    expect(await main(["--input", incomplete, "--source-modified", "2026-11-02"], incompleteRun.io)).toBe(2);
    expect(incompleteRun.err.join("")).toContain("complete=false");

    const wrongTotal = stageDir({ total_count: 4 });
    const wrongTotalRun = makeIo();
    expect(await main(["--input", wrongTotal, "--source-modified", "2026-11-02"], wrongTotalRun.io)).toBe(2);
    expect(wrongTotalRun.err.join("")).toContain("총 건수(4)");
  });
});
