import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadData } from "../src/data-store/load.js";
import { compareCenters, type HealthCenterEntry, type HealthCentersFile, HealthCentersSchema } from "../src/data-store/schema.js";
import { normalizeRegion } from "../src/region/normalize.js";
import { main } from "../scripts/build-health-centers.js";
import {
  buildHealthCenters,
  coverageNote,
  decodeCsvBytes,
  detectProfile,
  HeaderError,
  matchRegion,
  parseCsv,
  readSourceTable,
  type RegionLookup,
  SOURCE_PROFILES,
  type SourceRow,
  toSourceRows,
  WORDING_PATTERNS,
  wordingField,
} from "../scripts/lib/health-centers-csv.js";
import {
  applyCorrections,
  HEALTH_CENTER_CORRECTIONS,
  type HealthCenterCorrection,
} from "../scripts/lib/health-center-corrections.js";
import type { ScriptIO } from "../scripts/lib/script-io.js";
import { NEGATIVE_NOTICE_PATTERNS, scanNegativeWording, UNOFFICIAL_KO } from "./helpers/affiliation-wording.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dirs: string[] = [];

const readFixture = (name: string): Buffer => readFileSync(new URL(`./fixtures/health-centers/${name}`, import.meta.url));
const utf8Bytes = readFixture("sample-utf8.csv");
const euckrBytes = readFixture("sample-euckr.csv");
const utf8Text = decodeCsvBytes(utf8Bytes);
const table = parseCsv(utf8Text);

const code = (name: string): string => {
  const r = normalizeRegion(name);
  if (!r.ok || r.region.code === undefined) throw new Error(`지역 코드 계산 실패: ${name}`);
  return r.region.code;
};

const regions = loadData("regions");
const lookup: RegionLookup = { normalize: normalizeRegion, sido: regions.sido, sigungu: regions.sigungu };

const opts = {
  sourceModified: "2026-11-02",
  asOf: "2026-11-02",
  generatedAt: "2026-11-03",
  fileName: "sample-utf8.csv",
};

const build = (t: string[][], prev?: HealthCentersFile) => buildHealthCenters(toSourceRows(t), prev, { lookup, ...opts });

const makeIo = () => {
  const out: string[] = [];
  const err: string[] = [];
  const io: ScriptIO = {
    env: {},
    fetch: () => {
      throw new Error("global fetch disabled");
    },
    now: () => new Date("2026-11-03T00:00:00Z"),
    stdout: (t) => out.push(t),
    stderr: (t) => err.push(t),
  };
  return { io, out, err };
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

describe("health center CSV conversion", () => {
  it("decodes UTF-8, UTF-8 BOM and EUC-KR to the same text", () => {
    const utf8 = decodeCsvBytes(utf8Bytes);
    expect(decodeCsvBytes(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8Bytes]))).toBe(utf8);
    expect(decodeCsvBytes(euckrBytes)).toBe(utf8);
    expect(utf8.startsWith("보건기관명")).toBe(true);
  });

  it("parses quoted commas, doubled quotes and newlines", () => {
    expect(table[1]?.[6]).toBe('일반진료, "예방접종"');
    expect(table[3]?.[6]).toBe("진료\n검진");
    expect(table).toHaveLength(15);
    expect(parseCsv("a,b\r\n\r\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("fails with missing column names", () => {
    const header = [["보건기관명", "시도명", "보건기관유형명", "소재지도로명주소", "소재지지번주소", "홈페이지주소"]];
    const err = (() => {
      try {
        toSourceRows(header);
      } catch (e) {
        return e;
      }
      return undefined;
    })();
    expect(err).toBeInstanceOf(HeaderError);
    const headerError = err as HeaderError;
    expect(headerError.message).toContain("시군구명");
    expect(headerError.message).toContain("전화번호");
    expect(headerError.missing).toEqual(["시군구명", "전화번호"]);
  });

  it("absorbs old sido name", () => {
    const rows = toSourceRows(table);
    expect(matchRegion(rows[5] as (typeof rows)[number], lookup)).toEqual({ code: code("전남광주통합특별시 순천시") });
  });

  it("matches general-gu by institution name", () => {
    const rows = toSourceRows(table);
    expect(matchRegion(rows[2] as (typeof rows)[number], lookup)).toEqual({ code: code("경기도 수원시 장안구") });
    expect(matchRegion(rows[3] as (typeof rows)[number], lookup)).toEqual({ code: code("경기도 수원시") });
    expect(matchRegion(rows[4] as (typeof rows)[number], lookup)).toEqual({ code: code("경기도 수원시 영통구") });
  });

  it("reports unmatched rows with reasons", () => {
    const { report } = build(table);
    expect(report.unmatched).toHaveLength(2);
    expect(report.unmatched.some((m) => m.includes("14번째 행 가상없는구보건소"))).toBe(true);
    expect(report.unmatched.some((m) => m.includes("13번째 행 가상센터") && m.includes("유형 값"))).toBe(true);
  });

  it("keeps primaries and at most 3 secondaries only where no primary exists", () => {
    const { data } = build(table);
    expect(data.centers.some((c) => c.name === "가상가평군보건의료원")).toBe(true);
    expect(data.centers.filter((c) => c.code === code("경상북도 성주군")).map((c) => c.name)).toEqual([
      "가상성주보건지소가",
      "가상성주진료소나",
      "가상성주진료소다",
    ]);
    expect(data.centers.some((c) => c.name === "가상성동보건지소")).toBe(false);
    expect(data.centers.some((c) => c.name === "가상영통구보건지소")).toBe(false);
    expect(data.counts).toEqual({ source_rows: 14, kept: data.centers.length, unmatched: 2 });
    expect(HealthCentersSchema.safeParse(data).success).toBe(true);
  });

  it("reports multiple primaries", () => {
    const { report } = build(table);
    expect(report.multiplePrimary).toEqual([`${code("서울특별시 성동구")}: 가상성동보건소, 가상성동제2보건소`]);
  });

  it("field issues without guessing", () => {
    const { data, report } = build(table);
    const gapyeong = data.centers.find((c) => c.name === "가상가평군보건의료원");
    expect(gapyeong).toBeDefined();
    expect(gapyeong?.homepage).toBeUndefined();
    expect(gapyeong?.phone).toBe("0310000007");
    expect(gapyeong?.source_date).toBe("2026-10-01");
    expect(report.fieldIssues).toHaveLength(1);
    expect(report.fieldIssues[0]).toContain("홈페이지 주소 형식");
  });

  it("sorts deterministically", () => {
    const forward = build(table).data.centers;
    const reversed = toSourceRows([table[0] ?? [], ...table.slice(1).reverse()]);
    const backward = buildHealthCenters(reversed, undefined, { lookup, ...opts }).data.centers;
    expect(backward).toEqual(forward);
    for (let i = 1; i < forward.length; i++) {
      const a = forward[i - 1];
      const b = forward[i];
      if (a && b) expect(compareCenters(a, b)).toBeLessThan(0);
    }
  });

  it("inherits verification only when phone and homepage match", () => {
    const seeded = build(table).data;
    const prev: HealthCentersFile = {
      ...seeded,
      centers: seeded.centers.map((c) =>
        c.name === "가상성동보건소" || c.name === "가상순천시보건소"
          ? { ...c, verified: "full" as const, verified_by: "tester", verified_on: "2026-11-01" }
          : c,
      ),
    };
    const changedTable = table.map((row, i) => (i === 6 ? row.map((cell, j) => (j === 8 ? "061-000-9999" : cell)) : row));
    const { data, report } = build(changedTable, prev);
    const seongdong = data.centers.find((c) => c.name === "가상성동보건소");
    const suncheon = data.centers.find((c) => c.name === "가상순천시보건소");
    expect(seongdong?.verified).toBe("full");
    expect(seongdong?.verified_by).toBe("tester");
    expect(suncheon?.verified).toBe("partial");
    expect(suncheon?.verified_by).toBeUndefined();
    expect(report.changed).toBe(1);
    expect(report.added).toBe(0);
    expect(report.removed).toBe(0);

    expect(build(table, prev).report.changed).toBe(0);
  });

  it("CLI --check writes nothing and returns 10 then 0", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hc-"));
    dirs.push(dir);
    const out = join(dir, "hc.json");
    const input = fileURLToPath(new URL("./fixtures/health-centers/sample-utf8.csv", import.meta.url));

    const first = makeIo();
    expect(await main(["--input", input, "--source-modified", "2026-11-02", "--out", out, "--check"], first.io, { corrections: [] })).toBe(10);
    expect(existsSync(out)).toBe(false);
    const firstText = first.out.join("");
    expect(firstText).toContain("원본 행: 14");
    expect(firstText).toContain("미일치: 2");

    const second = makeIo();
    expect(await main(["--input", input, "--source-modified", "2026-11-02", "--out", out], second.io, { corrections: [] })).toBe(0);
    expect(existsSync(out)).toBe(true);
    expect(HealthCentersSchema.safeParse(JSON.parse(readFileSync(out, "utf8"))).success).toBe(true);

    const third = makeIo();
    expect(await main(["--input", input, "--source-modified", "2026-11-02", "--out", out, "--check"], third.io, { corrections: [] })).toBe(0);

    writeFileSync(join(dir, "changed.csv"), utf8Text.replace("02-000-0001", "02-000-9001"));
    const changedInput = join(dir, "changed.csv");
    const fourth = makeIo();
    expect(
      await main(["--input", changedInput, "--source-modified", "2026-11-02", "--out", out, "--check"], fourth.io, { corrections: [] }),
    ).toBe(10);
  });

  it("CLI errors carry the cause", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hc-err-"));
    dirs.push(dir);
    const input = fileURLToPath(new URL("./fixtures/health-centers/sample-utf8.csv", import.meta.url));

    const noInput = makeIo();
    expect(await main(["--source-modified", "2026-11-02"], noInput.io)).toBe(1);
    expect(noInput.err.join("")).toContain("--input");

    const relative = makeIo();
    expect(await main(["--input", "relative.csv", "--source-modified", "2026-11-02"], relative.io)).toBe(1);
    expect(relative.err.join("")).toContain("절대 경로");

    const missingPath = join(dir, "none.csv");
    const missing = makeIo();
    expect(await main(["--input", missingPath, "--source-modified", "2026-11-02"], missing.io)).toBe(2);
    expect(missing.err.join("")).toContain("읽지 못했어요");
    expect(missing.err.join("")).toContain(missingPath);

    const badHeader = join(dir, "bad.csv");
    writeFileSync(badHeader, "보건기관명,시도명\n가,나\n");
    const header = makeIo();
    expect(await main(["--input", badHeader, "--source-modified", "2026-11-02"], header.io)).toBe(2);
    expect(header.err.join("")).toContain("시군구명");

    const badDate = makeIo();
    expect(await main(["--input", input, "--source-modified", "2026-13-40"], badDate.io)).toBe(1);
  });

  it("sources have no network or key access", () => {
    const sources = ["scripts/lib/health-centers-csv.ts", "scripts/lib/health-centers-api.ts", "scripts/build-health-centers.ts"].map((p) =>
      readFileSync(join(root, p), "utf8"),
    );
    const forbidden = [
      /\bfetch\b/,
      /["']node:https?["']/,
      /["'](https?|undici|node-fetch|axios)["']/,
      /process\.env/,
      /\bio\.env\b/,
      /\.key\.txt/,
      /SERVICE_KEY/,
    ];
    for (const src of sources) {
      for (const re of forbidden) expect(src).not.toMatch(re);
    }
  });
});

describe("M58 wording and note", () => {
  const row = (n: number, overrides: Partial<SourceRow> = {}): SourceRow => ({
    row: n,
    name: "",
    sido: "서울특별시",
    sigungu: "성동구",
    kind: "보건소",
    roadAddress: "",
    lotAddress: "",
    homepage: "",
    phone: "",
    dataDate: "",
    ...overrides,
  });

  it("wording patterns equal the PAC39 file-layer patterns", () => {
    expect(WORDING_PATTERNS.map(String)).toEqual(NEGATIVE_NOTICE_PATTERNS.map(String));
  });

  it("excludes entries whose text fails the wording rule and reports them", () => {
    const rows: SourceRow[] = [
      row(1, { name: `${UNOFFICIAL_KO}보건소` }),
      row(2, { sigungu: "중구", name: "중구보건소", roadAddress: "서울 중구 아니길 1" }),
      row(3, { sigungu: "종로구", name: "종로구보건소" }),
    ];
    const { data, report } = buildHealthCenters(rows, undefined, { lookup, ...opts });
    expect(data.centers.map((c) => c.name)).toEqual(["종로구보건소"]);
    expect(data.counts.kept).toBe(1);
    expect(report.fieldIssues).toHaveLength(2);
    expect(report.fieldIssues.every((issue) => issue.includes("PAC39"))).toBe(true);
    expect(report.fieldIssues.some((issue) => issue.includes("기관명"))).toBe(true);
    expect(report.fieldIssues.some((issue) => issue.includes("주소"))).toBe(true);
    expect(HealthCentersSchema.safeParse(data).success).toBe(true);
  });

  it("writes the coverage note only while coverage is short", () => {
    expect(coverageNote(28, 269)).toBe("주 기관 확인 지역 28/269곳. 목록에 없는 지역은 안내 링크로 대신해요");
    expect(coverageNote(269, 269)).toBeUndefined();

    const seongdong = [row(3, { name: "성동구보건소" })];
    const short = buildHealthCenters(seongdong, undefined, { lookup, ...opts }).data;
    expect(short.note).toBe(coverageNote(1, 269));

    const full = buildHealthCenters(seongdong, undefined, {
      ...opts,
      lookup: { ...lookup, sigungu: regions.sigungu.filter((g) => g.code === "11200") },
    }).data;
    expect(full.note).toBeUndefined();

    expect(WORDING_PATTERNS.every((p) => !p.test(coverageNote(1, 2) as string))).toBe(true);
  });
});

describe("3072692 profile", () => {
  const bytes3 = readFixture("sample-3072692-cp949.csv");
  const table3 = parseCsv(decodeCsvBytes(bytes3));
  const read3 = readSourceTable(table3);
  const opts3 = { ...opts, sourceModified: "2025-12-31", asOf: "2025-12-31", fileName: "sample-3072692-cp949.csv" };
  const built3 = buildHealthCenters(read3.rows, undefined, {
    lookup,
    ...opts3,
    profile: read3.profile,
    excludedKinds: read3.excludedKinds,
  });
  const rowNamed = (name: string): SourceRow => {
    const found = read3.rows.find((r) => r.name === name);
    if (found === undefined) throw new Error(`행 없음: ${name}`);
    return found;
  };
  const caughtHeaderError = (header: string[]): HeaderError => {
    try {
      detectProfile(header);
    } catch (e) {
      if (e instanceof HeaderError) return e;
      throw e;
    }
    throw new Error("HeaderError가 나지 않았어요");
  };

  it("fixture is CP949 with CRLF", () => {
    expect(() => new TextDecoder("utf-8", { fatal: true }).decode(bytes3)).toThrow();
    expect(bytes3.includes(0x0d)).toBe(true);
    expect(decodeCsvBytes(bytes3).startsWith("시도,시군구,보건기관명")).toBe(true);
  });

  it("detects each profile", () => {
    expect(detectProfile(table[0] ?? [])).toBe("15107750");
    expect(detectProfile(table3[0] ?? [])).toBe("3072692");

    const neither = caughtHeaderError(["보건기관명", "시도"]);
    expect(neither).toBeInstanceOf(HeaderError);
    expect(neither.byProfile?.["15107750"]).toContain("시군구명");
    expect(neither.byProfile?.["3072692"]).toContain("대표 전화번호");
    expect(neither.message).toContain("15107750");
    expect(neither.message).toContain("3072692");
    expect(neither.message).toContain("시군구명");
    expect(neither.message).toContain("대표 전화번호");

    expect(() => detectProfile([...(table[0] ?? []), ...(table3[0] ?? [])])).toThrow(HeaderError);
  });

  it("maps kinds and counts excluded kinds", () => {
    expect(read3.profile).toBe("3072692");
    expect(read3.excludedKinds).toEqual({ 건강생활지원센터: 1 });
    expect(read3.rows).toHaveLength(14);
    expect(read3.rows.some((r) => r.row === 2)).toBe(false);
    expect(rowNamed("가상성주통합보건지소").kind).toBe("보건지소");
    expect(rowNamed("가상성주일반보건지소").kind).toBe("보건지소");
    expect(rowNamed("가상성주보건진료소").kind).toBe("보건진료소");
    expect(built3.report.unmatched.some((u) => u.includes("건강생활지원센터"))).toBe(false);
  });

  it("trims cells and matches region variants", () => {
    expect(rowNamed("가상부산진구보건소").sigungu).toBe("부산진구");
    expect(matchRegion(rowNamed("가상광주북구보건소"), lookup)).toEqual({ code: code("전남광주통합특별시 북구") });
    expect(matchRegion(rowNamed("가상순천시보건소"), lookup)).toEqual({ code: code("전남광주통합특별시 순천시") });
    expect(matchRegion(rowNamed("가상세종보건소"), lookup)).toEqual({ code: "36110" });
    expect(matchRegion(rowNamed("가상세종보건지소"), lookup)).toEqual({ code: "36110" });
    expect(matchRegion(rowNamed("가상장안구보건소"), lookup)).toEqual({ code: code("경기도 수원시 장안구") });
    expect(matchRegion(rowNamed("가상부산진구보건소"), lookup)).toEqual({ code: code("부산광역시 부산진구") });
    expect(matchRegion(rowNamed("가상군위군보건소"), lookup)).toEqual({ code: "27720" });
  });

  it("reports abolished districts without moving them", () => {
    expect(built3.report.unmatched).toHaveLength(2);
    expect(
      built3.report.unmatched.some(
        (u) => u.includes("가상인천중구보건소") && u.includes("폐지된 지역") && u.includes("2026-07-01"),
      ),
    ).toBe(true);
    expect(
      built3.report.unmatched.some(
        (u) => u.includes("가상경북군위보건지소") && u.includes("폐지된 지역") && u.includes("2023-07-01"),
      ),
    ).toBe(true);
    expect(built3.data.centers.some((c) => c.name === "가상인천중구보건소")).toBe(false);
  });

  it("keeps the first of duplicate keys", () => {
    const seongdong = built3.data.centers.filter((c) => c.name === "가상성동구보건소");
    expect(seongdong).toHaveLength(1);
    expect(seongdong[0]?.phone).toBe("02-000-3001");
    expect(built3.report.fieldIssues).toHaveLength(1);
    expect(built3.report.fieldIssues[0]).toContain("15번째 행");
    expect(built3.report.fieldIssues[0]).toContain("같은 이름·유형");
    expect(built3.report.multiplePrimary).toEqual([]);
  });

  it("builds the 3072692 file", () => {
    expect(built3.report.profile).toBe("3072692");
    expect(built3.report.excludedKinds).toEqual({ 건강생활지원센터: 1 });
    expect(built3.data.counts).toEqual({ source_rows: 15, kept: 10, unmatched: 2 });
    expect(built3.data.centers.filter((c) => c.code === "47840").map((c) => c.name)).toEqual([
      "가상성주일반보건지소",
      "가상성주통합보건지소",
      "가상성주보건진료소",
    ]);
    expect(built3.data.centers.some((c) => c.name === "가상세종보건지소")).toBe(false);
    expect(built3.data.source).toEqual({
      ...SOURCE_PROFILES["3072692"].source,
      license: null,
      source_modified: "2025-12-31",
      file_name: "sample-3072692-cp949.csv",
    });
    expect(built3.data.centers.every((c) => c.source_date === undefined)).toBe(true);
    expect(HealthCentersSchema.safeParse(built3.data).success).toBe(true);
  });

  it("15107750 build reports its profile", () => {
    const report = build(table).report;
    expect(report.profile).toBe("15107750");
    expect(report.excludedKinds).toEqual({});
  });

  it("CLI reads the 3072692 fixture", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hc3-"));
    dirs.push(dir);
    const out = join(dir, "hc3.json");
    const input = fileURLToPath(new URL("./fixtures/health-centers/sample-3072692-cp949.csv", import.meta.url));
    const args = ["--input", input, "--source-modified", "2025-12-31", "--out", out];

    const first = makeIo();
    expect(await main(args, first.io, { corrections: [] })).toBe(0);
    const firstText = first.out.join("");
    expect(firstText).toContain("원본 형식: 3072692");
    expect(firstText).toContain("제외 유형: 건강생활지원센터 1");
    expect(firstText).toContain("원본 행: 15");
    expect(firstText).toContain("미일치: 2");

    const saved = JSON.parse(readFileSync(out, "utf8")) as HealthCentersFile;
    expect(saved.as_of).toBe("2025-12-31");
    expect(saved.source.dataset_id).toBe("3072692");

    const second = makeIo();
    expect(await main([...args, "--check"], second.io, { corrections: [] })).toBe(0);
  });
});

describe("M65 corrections", () => {
  const CORR: HealthCenterCorrection = {
    code: code("서울특별시 성동구"),
    name: "가상성동보건소",
    field: "phone",
    from: "02-000-0001",
    to: "02-000-1001",
    source_url: "https://example.invalid/hc",
    checked_on: "2026-11-04",
    verified_by: "agent web check (example.invalid)",
  };
  const sc = (phone?: string): HealthCenterEntry => ({
    code: CORR.code,
    name: CORR.name,
    kind: "보건소",
    ...(phone ? { phone } : {}),
    verified: "partial",
  });
  const changedTable = table.map((row, i) => (i === 6 ? row.map((cell, j) => (j === 8 ? "061-000-9999" : cell)) : row));
  const staleCases: [string, HealthCenterEntry[], string][] = [
    ["mismatch", [sc("02-000-0002")], `${CORR.code}|가상성동보건소 phone: 현재 값 02-000-0002, 정정 전 값 02-000-0001`],
    ["already to", [sc("02-000-1001")], `${CORR.code}|가상성동보건소 phone: 현재 값 02-000-1001, 정정 전 값 02-000-0001`],
    ["no phone", [sc()], `${CORR.code}|가상성동보건소 phone: 현재 값 없음, 정정 전 값 02-000-0001`],
    ["missing", [], `${CORR.code}|가상성동보건소 phone: 목록에서 항목을 찾지 못했어요(정정 전 값 02-000-0001)`],
  ];

  it("correction table has three official rows", () => {
    expect(HEALTH_CENTER_CORRECTIONS.map((c) => `${c.code}|${c.name}|${c.from}|${c.to}`)).toEqual([
      "11440|마포구보건소|02-3153-9114|02-3153-8114",
      "12790|해남군보건소|061-531-3713|061-531-3738",
      "41117|영통구보건소|031-5191-0718|031-5191-0778",
    ]);
    for (const c of HEALTH_CENTER_CORRECTIONS) {
      expect(c.field).toBe("phone");
      expect(c.source_url).toMatch(/^https?:\/\/(www\.)?(mapo\.go\.kr|haenam\.go\.kr|health\.suwon\.go\.kr)\//);
      expect(c.checked_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(c.verified_by).toMatch(/^agent web check \(.+\)$/);
    }
    expect(scanNegativeWording(JSON.stringify(HEALTH_CENTER_CORRECTIONS)).violations).toEqual([]);
  });

  it("applies a correction with verification fields", () => {
    const input = [sc("02-000-0001")];
    const r = applyCorrections(input, [CORR]);
    expect(r.entries[0]).toEqual({
      ...input[0],
      phone: "02-000-1001",
      verified: "full",
      verified_by: "agent web check (example.invalid)",
      verified_on: "2026-11-04",
    });
    expect(r.applied).toEqual([`${CORR.code}|가상성동보건소 phone: 02-000-0001 → 02-000-1001`]);
    expect(r.stale).toEqual([]);
    expect(input[0]?.phone).toBe("02-000-0001");
  });

  it.each(staleCases)("reports stale rows and leaves entries unchanged: %s", (_label, input, message) => {
    const r = applyCorrections(input, [CORR]);
    expect(r.entries).toEqual(input);
    expect(r.applied).toEqual([]);
    expect(r.stale).toEqual([message]);
  });

  it("correction overrides inherited verification and rebuilds cleanly", () => {
    const rows = toSourceRows(table);
    const base = build(table).data;
    const prev: HealthCentersFile = {
      ...base,
      centers: base.centers.map((c) =>
        c.name === "가상성동보건소" ? { ...c, verified: "false" as const, verified_by: "tester", verified_on: "2026-11-01" } : c,
      ),
    };
    const first = buildHealthCenters(rows, prev, { lookup, ...opts, generatedAt: "2026-11-09", corrections: [CORR] });
    expect(first.data.centers.find((c) => c.name === "가상성동보건소")).toMatchObject({
      phone: "02-000-1001",
      verified: "full",
      verified_by: "agent web check (example.invalid)",
      verified_on: "2026-11-04",
    });
    expect(first.report.changed).toBe(1);
    expect(first.report.corrections.stale).toEqual([]);
    expect(first.data.generated_at).toBe("2026-11-03");
    expect(first.data.verified).toBe(prev.verified);

    const second = buildHealthCenters(rows, first.data, { lookup, ...opts, generatedAt: "2026-11-10", corrections: [CORR] });
    expect(second.report.changed).toBe(0);
    expect(second.data).toEqual(first.data);

    const sourceChanged = buildHealthCenters(toSourceRows(changedTable), first.data, {
      lookup,
      ...opts,
      generatedAt: "2026-11-10",
      corrections: [CORR],
    });
    expect(sourceChanged.data.generated_at).toBe("2026-11-10");
  });

  it("CLI applies corrections and --check is clean", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hc-corr-"));
    dirs.push(dir);
    const out = join(dir, "hc.json");
    const input = fileURLToPath(new URL("./fixtures/health-centers/sample-utf8.csv", import.meta.url));
    const args = ["--input", input, "--source-modified", "2026-11-02", "--out", out];

    const write = makeIo();
    expect(await main(args, write.io, { corrections: [CORR] })).toBe(0);
    const saved = JSON.parse(readFileSync(out, "utf8")) as HealthCentersFile;
    expect(saved.centers.find((c) => c.name === "가상성동보건소")).toMatchObject({ phone: "02-000-1001", verified: "full" });
    expect(write.out.join("")).toContain("정정 표: 적용 1 · 다시 확인 0");

    const check = makeIo();
    expect(await main([...args, "--check"], check.io, { corrections: [CORR] })).toBe(0);
  });

  it("CLI stops with exit 1 on stale rows and writes nothing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hc-stale-"));
    dirs.push(dir);
    const out = join(dir, "hc.json");
    const input = fileURLToPath(new URL("./fixtures/health-centers/sample-utf8.csv", import.meta.url));
    const args = ["--input", input, "--source-modified", "2026-11-02", "--out", out];
    const stale = [{ ...CORR, from: "02-000-0009" }];

    const write = makeIo();
    expect(await main(args, write.io, { corrections: stale })).toBe(1);
    expect(existsSync(out)).toBe(false);
    expect(write.err.join("")).toContain("정정 표를 다시 확인하세요");
    expect(write.err.join("")).toContain("가상성동보건소");

    const check = makeIo();
    expect(await main([...args, "--check"], check.io, { corrections: stale })).toBe(1);
    expect(existsSync(out)).toBe(false);

    const defaults = makeIo();
    expect(await main(args, defaults.io)).toBe(1);
    expect(defaults.err.join("")).toContain("11440|마포구보건소");
    expect(defaults.err.join("")).toContain("12790|해남군보건소");
    expect(defaults.err.join("")).toContain("41117|영통구보건소");
    expect(existsSync(out)).toBe(false);
  });
});
