import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { loadData } from "../src/data-store/load.js";
import { type HealthCentersFile, HealthCentersSchema, IsoDate } from "../src/data-store/schema.js";
import { normalizeRegion } from "../src/region/normalize.js";
import {
  API_FILE_NAME,
  ApiPageError,
  apiItemsToSourceRows,
  MANIFEST_FILE,
  PAGE_FILE_RE,
  parseApiManifest,
  parseApiPage,
} from "./lib/health-centers-api.js";
import { HEALTH_CENTER_CORRECTIONS, type HealthCenterCorrection } from "./lib/health-center-corrections.js";
import {
  buildHealthCenters,
  decodeCsvBytes,
  HeaderError,
  parseCsv,
  readSourceTable,
  type RegionLookup,
  type SourceProfileId,
  type SourceRow,
} from "./lib/health-centers-csv.js";
import { EXIT, isMainModule, parseFlags, processIO, type ScriptIO } from "./lib/script-io.js";

const USAGE = "사용법: node build-scripts/scripts/build-health-centers.js --input <원본 CSV 파일 또는 API 쪽 폴더의 절대 경로> --source-modified YYYY-MM-DD [--as-of YYYY-MM-DD] [--out data/health-centers.json] [--check]";

function bulletsOrNone(items: readonly string[]): string[] {
  return items.length === 0 ? ["- 없음"] : items.map((item) => `- ${item}`);
}

export async function main(
  argv: readonly string[],
  io: ScriptIO,
  deps?: { lookup?: RegionLookup; corrections?: readonly HealthCenterCorrection[] },
): Promise<number> {
  try {
    const check = argv.includes("--check");
    const rest = argv.filter((arg) => arg !== "--check");
    const parsed = parseFlags(rest, ["--input", "--source-modified", "--as-of", "--out"]);
    if ("error" in parsed) {
      io.stderr(`${USAGE}\n${parsed.error}\n`);
      return EXIT.USAGE;
    }
    const flags = parsed.flags;

    const input = flags["--input"];
    if (input === undefined) {
      io.stderr(`${USAGE}\n--input이 필요해요(원본 CSV 파일 또는 API 쪽 폴더의 절대 경로).\n`);
      return EXIT.USAGE;
    }
    if (!isAbsolute(input)) {
      io.stderr(`--input은 절대 경로여야 해요: ${input}\n`);
      return EXIT.USAGE;
    }
    const sourceModified = flags["--source-modified"];
    if (sourceModified === undefined || !IsoDate.safeParse(sourceModified).success) {
      io.stderr("--source-modified는 YYYY-MM-DD 날짜여야 해요\n");
      return EXIT.USAGE;
    }
    const asOf = flags["--as-of"] ?? sourceModified;
    if (!IsoDate.safeParse(asOf).success) {
      io.stderr("--as-of는 YYYY-MM-DD 날짜여야 해요\n");
      return EXIT.USAGE;
    }
    const out = resolve(flags["--out"] ?? "data/health-centers.json");

    const isDir = statSync(input, { throwIfNoEntry: false })?.isDirectory() === true;
    let rows: SourceRow[];
    let fileName: string;
    let profile: SourceProfileId = "15107750";
    let excludedKinds: Record<string, number> = {};
    try {
      if (isDir) {
        let manifestText: string;
        try {
          manifestText = readFileSync(join(input, MANIFEST_FILE), "utf8");
        } catch {
          io.stderr(`원본 폴더에서 manifest.json을 찾지 못했어요: ${input}\n`);
          return EXIT.UNAVAILABLE;
        }
        const m = parseApiManifest(manifestText);
        if (!m.complete) {
          io.stderr(`받기가 끝나지 않은 폴더예요(complete=false): ${input}. 받기 스크립트를 다시 실행하세요\n`);
          return EXIT.UNAVAILABLE;
        }
        const files = readdirSync(input).filter((f) => PAGE_FILE_RE.test(f)).sort();
        const items = files.flatMap((f) => parseApiPage(readFileSync(join(input, f), "utf8")).items);
        if (items.length !== m.total_count) {
          io.stderr(`받은 항목 수(${items.length})가 총 건수(${m.total_count})와 달라요: ${input}\n`);
          return EXIT.UNAVAILABLE;
        }
        rows = apiItemsToSourceRows(items);
        fileName = API_FILE_NAME;
      } else {
        let bytes: Uint8Array;
        try {
          bytes = readFileSync(input);
        } catch (e) {
          const err = e as NodeJS.ErrnoException;
          io.stderr(`원본 파일을 읽지 못했어요: ${input} (${err.code ?? err.message})\n`);
          return EXIT.UNAVAILABLE;
        }
        const read = readSourceTable(parseCsv(decodeCsvBytes(bytes)));
        rows = read.rows;
        profile = read.profile;
        excludedKinds = read.excludedKinds;
        fileName = basename(input);
      }
    } catch (e) {
      if (e instanceof ApiPageError || e instanceof HeaderError) {
        io.stderr(`${e.message}\n`);
        return EXIT.UNAVAILABLE;
      }
      throw e;
    }

    let prev: HealthCentersFile | undefined;
    if (existsSync(out)) {
      const checked = HealthCentersSchema.safeParse(JSON.parse(readFileSync(out, "utf8")));
      if (!checked.success) {
        const issue = checked.error.issues[0];
        const detail = issue === undefined ? "" : `${issue.path.join(".")}: ${issue.message}`;
        io.stderr(`기존 목록 파일을 확인하세요: ${out} (${detail})\n`);
        return EXIT.UNAVAILABLE;
      }
      prev = checked.data;
    }

    const regions = loadData("regions");
    const lookup: RegionLookup = deps?.lookup ?? { normalize: normalizeRegion, sido: regions.sido, sigungu: regions.sigungu };
    const { data, report } = buildHealthCenters(rows, prev, {
      lookup,
      sourceModified,
      asOf,
      generatedAt: io.now().toISOString().slice(0, 10),
      fileName,
      profile,
      excludedKinds,
      corrections: deps?.corrections ?? HEALTH_CENTER_CORRECTIONS,
    });

    const range = report.dataDateRange;
    const excludedEntries = Object.entries(report.excludedKinds)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, n]) => `${k} ${n}`)
      .join(", ");
    const lines = [
      `원본 형식: ${report.profile}`,
      `원본 행: ${data.counts.source_rows}`,
      `제외 유형: ${excludedEntries === "" ? "없음" : excludedEntries}`,
      `유지: ${data.counts.kept}`,
      `미일치: ${report.unmatched.length}`,
      `복수 주 기관: ${report.multiplePrimary.length}`,
      range === null ? "데이터기준일자: 없음" : `데이터기준일자: ${range.min} ~ ${range.max}`,
      `주 기관 지역: ${report.coverage.covered}/${report.coverage.units}`,
      `추가 ${report.added} · 삭제 ${report.removed} · 변경 ${report.changed}`,
      `정정 표: 적용 ${report.corrections.applied.length} · 다시 확인 ${report.corrections.stale.length}`,
      "정정 적용:",
      ...bulletsOrNone(report.corrections.applied),
      "미일치 행:",
      ...bulletsOrNone(report.unmatched),
      "복수 주 기관 목록:",
      ...bulletsOrNone(report.multiplePrimary),
      "필드 확인:",
      ...bulletsOrNone(report.fieldIssues),
      "주 기관을 찾지 못한 지역:",
      ...bulletsOrNone(report.coverage.missing),
    ];
    io.stdout(`${lines.join("\n")}\n`);

    if (report.corrections.stale.length > 0) {
      io.stderr(["정정 표를 다시 확인하세요. 원본 값이 정정 표의 정정 전 값과 달라요. 출력 파일은 그대로 두었어요.", ...report.corrections.stale.map((s) => `- ${s}`)].join("\n") + "\n");
      return EXIT.USAGE; // 종료 코드 1 (ADR-65)
    }

    if (check) {
      return prev === undefined || report.added + report.removed + report.changed > 0 ? EXIT.CHANGED : EXIT.OK;
    }

    HealthCentersSchema.parse(data);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(data, null, 2) + "\n");
    io.stdout(`저장했어요: ${out}\n`);
    return EXIT.OK;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    io.stderr(`확인 불가: 내부 오류 (${message})\n`);
    return EXIT.UNAVAILABLE;
  }
}

if (isMainModule(import.meta.url)) void main(process.argv.slice(2), processIO()).then((c) => { process.exitCode = c; });
