import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadData, validateDataset } from "../src/data-store/load.js";
import { checkHolidaySanity, FIXED_SOLAR_HOLIDAYS, type HolidayEntry } from "../src/date/holiday-sanity.js";
import { defaultYears, main } from "../scripts/refresh-holidays.js";
import type { ScriptIO } from "../scripts/lib/script-io.js";
import { createKasiMock, entriesToItems, emptyRes, htmlRes200, kasiXml, xmlRes } from "./helpers/kasi-mock.js";

const K = "Ab+cD/eF=gH+iJ k/L==";
const FAKE_ENV: Record<string, string> = { DATA_GO_KR_SERVICE_KEY: K };
const NOW = new Date("2026-11-02T00:00:00Z");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_FILE = join(root, "data", "holidays.json");

const NAMES: Record<string, string> = {
  "01-01": "신정",
  "03-01": "삼일절",
  "05-01": "노동절",
  "05-05": "어린이날",
  "06-06": "현충일",
  "07-17": "제헌절",
  "08-15": "광복절",
  "10-03": "개천절",
  "10-09": "한글날",
  "12-25": "성탄절",
};

const FIXED2028: HolidayEntry[] = [
  ...FIXED_SOLAR_HOLIDAYS.map((md) => ({ date: `2028-${md}`, name: NAMES[md] ?? md })),
  { date: "2028-09-15", name: "추석" },
];

interface Holidays {
  source: string;
  generated_at: string;
  covers_years: number[];
  years: Record<string, HolidayEntry[]>;
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  urls: string[];
}

function FORMS(x: string): string[] {
  return [x, encodeURIComponent(x), new URLSearchParams({ k: x }).toString().slice(2)];
}

const dirs: string[] = [];
let original: Buffer;
let dir: string;
let file: string;
let outDir: string;

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "kpm-hol-"));
  dirs.push(d);
  return d;
}

function resetFile(): void {
  copyFileSync(DATA_FILE, file);
}

function readHolidays(): Holidays {
  return JSON.parse(readFileSync(file, "utf8")) as Holidays;
}

function bundleYear(year: number): HolidayEntry[] {
  return loadData("holidays").years[String(year)] ?? [];
}

function okYear(entries: readonly HolidayEntry[]): () => Response {
  return () => xmlRes(kasiXml(entriesToItems(entries)));
}

async function run(args: string[], byYear: Record<number, () => Response>, env: Record<string, string> = FAKE_ENV): Promise<RunResult> {
  const mock = createKasiMock(byYear);
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io: ScriptIO = {
    env,
    fetch: mock.fetch,
    now: () => NOW,
    stdout: (text) => {
      stdout.push(text);
    },
    stderr: (text) => {
      stderr.push(text);
    },
  };
  const code = await main(["--file", file, ...args], io);
  return { code, stdout: stdout.join(""), stderr: stderr.join(""), urls: mock.urls };
}

beforeAll(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error("global fetch disabled");
  });
  original = readFileSync(DATA_FILE);
});

afterAll(() => {
  vi.unstubAllGlobals();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  expect(readFileSync(DATA_FILE).equals(original)).toBe(true);
});

beforeEach(() => {
  dir = tmp();
  file = join(dir, "holidays.json");
  outDir = tmp();
  resetFile();
});

describe("refresh-holidays script", () => {
  it("new year 2028 → 10, then rerun is byte-identical 0", async () => {
    const r1 = await run(["--years", "2028", "--summary-out", join(outDir, "pr.md")], { 2028: okYear(FIXED2028) });
    expect(r1.code).toBe(10);
    const parsed = readHolidays();
    expect(parsed.years["2028"]).toBeDefined();
    expect(parsed.covers_years).toContain(2028);
    expect(parsed.covers_years).toEqual([...parsed.covers_years].sort((a, b) => a - b));
    expect(parsed.generated_at).toBe("2026-11-02");
    expect(parsed.source).toBe("kasi-api");
    expect(() => validateDataset("holidays", parsed, loadData("basis-documents"))).not.toThrow();
    expect(checkHolidaySanity(2028, parsed.years["2028"] ?? []).ok).toBe(true);

    const bytes = readFileSync(file);
    const r2 = await run(["--years", "2028", "--summary-out", join(outDir, "pr2.md")], { 2028: okYear(FIXED2028) });
    expect(r2.code).toBe(0);
    expect(readFileSync(file).equals(bytes)).toBe(true);
  });

  it("sanity failures and fetch failures keep existing values", async () => {
    const before = readFileSync(file);

    const noLabor = bundleYear(2026).filter((e) => !e.date.endsWith("-05-01"));
    const r1 = await run(["--years", "2026"], { 2026: okYear(noLabor) });
    expect(r1.code).toBe(2);
    expect(readFileSync(file).equals(before)).toBe(true);

    const noConstitution = bundleYear(2026).filter((e) => !e.date.endsWith("-07-17"));
    const r2 = await run(["--years", "2026"], { 2026: okYear(noConstitution) });
    expect(r2.code).toBe(2);
    expect(readFileSync(file).equals(before)).toBe(true);

    const r3 = await run(["--years", "2028"], { 2028: () => emptyRes() });
    expect(r3.code).toBe(2);
    expect(readHolidays().years["2028"]).toBeUndefined();
    expect(readFileSync(file).equals(before)).toBe(true);

    const r4 = await run(["--years", "2028"], { 2028: () => xmlRes(kasiXml([], { resultCode: "22" })) });
    expect(r4.code).toBe(2);
    expect(readHolidays().years["2028"]).toBeUndefined();
    expect(readFileSync(file).equals(before)).toBe(true);
  });

  it("mixed failure and success reflects only successful years", async () => {
    const summaryFile = join(outDir, "pr.md");
    const r = await run(["--years", "2027,2028", "--summary-out", summaryFile], {
      2027: () => xmlRes(kasiXml([], { resultCode: "30" })),
      2028: okYear(FIXED2028),
    });
    expect(r.code).toBe(10);
    const parsed = readHolidays();
    expect(parsed.years["2028"]).toBeDefined();
    expect(parsed.years["2027"]).toEqual(bundleYear(2027));
    const summary = readFileSync(summaryFile, "utf8");
    expect(summary.split("## 반영하지 않은 연도")[1] ?? "").toContain("2027");
  });

  it("no key → 2, no fetch, file untouched", async () => {
    const before = readFileSync(file);
    const r = await run(["--years", "2026"], { 2026: okYear(bundleYear(2026)) }, {});
    expect(r.code).toBe(2);
    expect(r.urls.length).toBe(0);
    expect(readFileSync(file).equals(before)).toBe(true);
  });

  it("added temporary holiday in 2026 → 10 with summary", async () => {
    const summaryFile = join(outDir, "pr.md");
    const list2026 = [...bundleYear(2026), { date: "2026-10-07", name: "임시공휴일" }];
    const before = readFileSync(file);
    const r = await run(["--years", "2026", "--summary-out", summaryFile], { 2026: okYear(list2026) });
    expect(r.code).toBe(10);
    expect(r.stdout).toBe("");
    const summary = readFileSync(summaryFile, "utf8");
    expect(summary).toContain("2026-10-07 임시공휴일");
    expect(summary).toContain("반영하지 않은 연도");
    expect(summary).toContain(`generated_at: ${loadData("holidays").generated_at} → 2026-11-02`);
    expect(summary).toContain("검토 체크리스트");
    expect(summary).toContain("- [ ] ");
    expect(readdirSync(dir)).toEqual(["holidays.json"]);
    expect(readFileSync(file).equals(before)).toBe(false);
  });

  it("unchanged fixture → 0 and no summary", async () => {
    const summaryFile = join(outDir, "pr.md");
    const before = readFileSync(file);
    const r = await run(["--years", "2026", "--summary-out", summaryFile], { 2026: okYear(bundleYear(2026)) });
    expect(r.code).toBe(0);
    expect(existsSync(summaryFile)).toBe(false);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("변경 없음");
    expect(readFileSync(file).equals(before)).toBe(true);
  });

  it("schema-invalid result is not written", async () => {
    const before = readFileSync(file);
    const r = await run(["--years", "2028"], {
      2028: () =>
        xmlRes(kasiXml([...entriesToItems(FIXED2028), { locdate: "20280230", isHoliday: "Y", dateName: "잘못된날" }])),
    });
    expect(r.code).toBe(2);
    expect(readFileSync(file).equals(before)).toBe(true);
  });

  it("default years come from injected today", () => {
    expect(defaultYears(new Date("2026-12-31T15:30:00Z"))).toEqual([2027, 2028, 2029]);
  });

  it("secrets never appear", async () => {
    const scenarios: { args: string[]; routes: Record<number, () => Response> }[] = [
      { args: ["--years", "2028"], routes: { 2028: okYear(FIXED2028) } },
      { args: ["--years", "2028"], routes: { 2028: () => xmlRes(kasiXml([], { resultCode: "30" })) } },
      { args: ["--years", "2028"], routes: { 2028: () => htmlRes200() } },
      { args: ["--years", "2026"], routes: { 2026: okYear(bundleYear(2026)) } },
    ];
    for (const [i, sc] of scenarios.entries()) {
      resetFile();
      const summaryFile = join(outDir, `s${i}.md`);
      const r = await run([...sc.args, "--summary-out", summaryFile], sc.routes);
      const summary = existsSync(summaryFile) ? readFileSync(summaryFile, "utf8") : "";
      const blob = [r.stdout, r.stderr, summary, readFileSync(file, "utf8")].join("\n");
      for (const form of FORMS(K)) expect(blob).not.toContain(form);
    }
  });

  it("compiled CLI: no key → 2, bad years → 1", () => {
    const before = readFileSync(file);
    const env = { PATH: process.env.PATH ?? "" };
    const noKey = spawnSync(
      process.execPath,
      [join(root, "build-scripts/scripts/refresh-holidays.js"), "--file", file, "--years", "2026"],
      { env, encoding: "utf8", cwd: root },
    );
    expect(noKey.status).toBe(2);
    expect(readFileSync(file).equals(before)).toBe(true);

    const badYears = spawnSync(
      process.execPath,
      [join(root, "build-scripts/scripts/refresh-holidays.js"), "--file", file, "--years", "abc"],
      { env, encoding: "utf8", cwd: root },
    );
    expect(badYears.status).toBe(1);
  });
});
