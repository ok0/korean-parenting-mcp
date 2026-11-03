import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { loadData } from "../src/data-store/load.js";
import { type HealthCentersFile, HealthCentersSchema, IsoDate } from "../src/data-store/schema.js";
import { normalizeRegion } from "../src/region/normalize.js";
import {
  buildHealthCenters,
  decodeCsvBytes,
  HeaderError,
  parseCsv,
  type RegionLookup,
  type SourceRow,
  toSourceRows,
} from "./lib/health-centers-csv.js";
import { EXIT, isMainModule, parseFlags, processIO, type ScriptIO } from "./lib/script-io.js";

const USAGE = "사용법: node build-scripts/scripts/build-health-centers.js --input <내려받은 파일 절대 경로> --source-modified YYYY-MM-DD [--as-of YYYY-MM-DD] [--out data/health-centers.json] [--check]";

function bulletsOrNone(items: readonly string[]): string[] {
  return items.length === 0 ? ["- 없음"] : items.map((item) => `- ${item}`);
}

export async function main(argv: readonly string[], io: ScriptIO, deps?: { lookup?: RegionLookup }): Promise<number> {
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
      io.stderr(`${USAGE}\n--input이 필요해요(내려받은 원본 파일의 절대 경로).\n`);
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

    let bytes: Uint8Array;
    try {
      bytes = readFileSync(input);
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      io.stderr(`원본 파일을 읽지 못했어요: ${input} (${err.code ?? err.message})\n`);
      return EXIT.UNAVAILABLE;
    }

    let rows: SourceRow[];
    try {
      rows = toSourceRows(parseCsv(decodeCsvBytes(bytes)));
    } catch (e) {
      if (e instanceof HeaderError) {
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

    const lookup: RegionLookup = deps?.lookup ?? { normalize: normalizeRegion, sigungu: loadData("regions").sigungu };
    const { data, report } = buildHealthCenters(rows, prev, {
      lookup,
      sourceModified,
      asOf,
      generatedAt: io.now().toISOString().slice(0, 10),
      fileName: basename(input),
    });

    const lines = [
      `원본 행: ${data.counts.source_rows}`,
      `유지: ${data.counts.kept}`,
      `미일치: ${report.unmatched.length}`,
      `복수 주 기관: ${report.multiplePrimary.length}`,
      `추가 ${report.added} · 삭제 ${report.removed} · 변경 ${report.changed}`,
      "미일치 행:",
      ...bulletsOrNone(report.unmatched),
      "복수 주 기관 목록:",
      ...bulletsOrNone(report.multiplePrimary),
      "필드 확인:",
      ...bulletsOrNone(report.fieldIssues),
    ];
    io.stdout(`${lines.join("\n")}\n`);

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
