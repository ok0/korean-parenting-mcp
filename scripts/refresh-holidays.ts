import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { fetchKasiHolidays } from "../src/clients/kasi-holidays.js";
import type { ToolContext } from "../src/core/context.js";
import { ToolError } from "../src/core/errors.js";
import { formatDate, todayKst } from "../src/date/civil-date.js";
import { checkHolidaySanity, type HolidayEntry } from "../src/date/holiday-sanity.js";
import { DataValidationError, findDataDir, loadData, validateDataset } from "../src/data-store/load.js";
import { HolidayEntrySchema, type BasisDocuments } from "../src/data-store/schema.js";
import { createScriptContext, EXIT, isMainModule, parseFlags, processIO, type ScriptIO } from "./lib/script-io.js";

export interface YearChange {
  year: number;
  isNew: boolean;
  added: HolidayEntry[];
  removed: HolidayEntry[];
}

export interface Rejected {
  year: number;
  reason: string;
}

export interface RefreshResult {
  exitCode: 0 | 2 | 10;
  next?: Record<string, unknown>;
  changes: YearChange[];
  rejected: Rejected[];
  summary?: string;
  log: string;
}

const USAGE = "사용법: node build-scripts/scripts/refresh-holidays.js [--file <path>] [--years <YYYY,YYYY,...>] [--summary-out <path>]";

export function defaultYears(now: Date): number[] {
  const y = todayKst({ now: () => now }).y;
  return [y, y + 1, y + 2];
}

export function serializeHolidays(file: Record<string, unknown>): string {
  return JSON.stringify(file, null, 2) + "\n";
}

const keyOf = (e: HolidayEntry): string => e.date + "\u0000" + e.name;

const byDate = (a: HolidayEntry, b: HolidayEntry): number => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

function diffYear(year: number, prev: readonly HolidayEntry[], next: readonly HolidayEntry[], isNew: boolean): YearChange {
  const prevKeys = new Set(prev.map(keyOf));
  const nextKeys = new Set(next.map(keyOf));
  return {
    year,
    isNew,
    added: next.filter((e) => !prevKeys.has(keyOf(e))).sort(byDate),
    removed: prev.filter((e) => !nextKeys.has(keyOf(e))).sort(byDate),
  };
}

export function buildHolidaySummary(
  changes: readonly YearChange[],
  rejected: readonly Rejected[],
  prev: string,
  next: string,
): string {
  const lines: string[] = [
    "# 공휴일 데이터 갱신 (KASI 특일 정보)",
    "",
    `- generated_at: ${prev} → ${next}`,
    "- 출처: 한국천문연구원 특일 정보(공공데이터포털 15012690). 오퍼레이션·응답 필드는 M11 확정 전 잠정값",
    "- 이 PR은 `data/holidays.json`만 바꿉니다. 자동 병합하지 않습니다",
    "",
    "## 연도별 변경",
  ];
  for (const c of changes) {
    lines.push(`### ${c.year}${c.isNew ? " (새 연도)" : ""}`);
    if (c.added.length === 0) lines.push("- 추가: 없음");
    for (const e of c.added) lines.push(`- 추가: ${e.date} ${e.name}`);
    if (c.removed.length === 0) lines.push("- 삭제: 없음");
    for (const e of c.removed) lines.push(`- 삭제: ${e.date} ${e.name}`);
  }
  lines.push("", "## 반영하지 않은 연도");
  if (rejected.length === 0) lines.push("- 없음");
  for (const r of rejected) lines.push(`- ${r.year}: ${r.reason}`);
  lines.push(
    "",
    "## 검토 체크리스트",
    "- [ ] 임시공휴일·대체공휴일이 정부 발표(관보·월력요항)와 일치하는지 확인",
    "- [ ] 「관공서의 공휴일에 관한 규정」 제2조 고정 공휴일(1/1, 3/1, 5/1, 5/5, 6/6, 7/17, 8/15, 10/3, 10/9, 12/25)이 모두 있는지 확인",
    "- [ ] 삭제된 날짜가 실제로 공휴일에서 빠진 것인지 확인",
    "- [ ] 병합 전 `npm run verify` 통과 확인(자동 생성 PR에서는 CI가 자동 실행되지 않을 수 있음)",
  );
  return lines.join("\n") + "\n";
}

export async function runRefresh(
  ctx: ToolContext,
  raw: Record<string, unknown>,
  years: readonly number[],
  basis: BasisDocuments,
): Promise<RefreshResult> {
  const old = validateDataset("holidays", raw, basis);
  const targets = [...new Set(years)].sort((a, b) => a - b);
  const rejected: Rejected[] = [];
  const accepted = new Map<number, HolidayEntry[]>();
  const changes: YearChange[] = [];

  if (!ctx.config.keys.DATA_GO_KR) {
    return {
      exitCode: EXIT.UNAVAILABLE,
      changes,
      rejected,
      log: "확인 불가: DATA_GO_KR_SERVICE_KEY 미설정\n결과: 종료 2\n",
    };
  }

  const finish = (exitCode: 0 | 2 | 10, tail: string[] = []): RefreshResult => {
    const yearLines = targets.map((y) => {
      const r = rejected.find((x) => x.year === y);
      if (r) return `${y}: 반영하지 않음 — ${r.reason}`;
      const c = changes.find((x) => x.year === y);
      if (c) return `${y}: 반영(추가 ${c.added.length}, 삭제 ${c.removed.length})`;
      return `${y}: 변경 없음`;
    });
    return {
      exitCode,
      changes,
      rejected,
      log: [...yearLines, ...tail, `결과: 종료 ${exitCode}`].join("\n") + "\n",
    };
  };

  for (const y of targets) {
    let entries: HolidayEntry[];
    try {
      entries = await fetchKasiHolidays(y, ctx);
    } catch (e) {
      rejected.push({ year: y, reason: e instanceof ToolError ? `조회 실패(${e.kind}): ${e.message}` : "조회 실패" });
      continue;
    }
    if (entries.length === 0) {
      rejected.push({ year: y, reason: "빈 응답(아직 발표되지 않은 연도일 수 있음)" });
      continue;
    }
    if (!z.array(HolidayEntrySchema).safeParse(entries).success || entries.some((e) => !e.date.startsWith(`${y}-`))) {
      rejected.push({ year: y, reason: "형식 오류(날짜·명칭)" });
      continue;
    }
    const sanity = checkHolidaySanity(y, entries);
    if (!sanity.ok) {
      rejected.push({ year: y, reason: `고정 공휴일 누락: ${sanity.missing.join(", ")}` });
      continue;
    }
    accepted.set(y, entries);
  }

  if (accepted.size === 0) return finish(EXIT.UNAVAILABLE);

  for (const [y, entries] of accepted) {
    const prevList = old.years[String(y)] ?? [];
    const isNew = !old.covers_years.includes(y);
    const change = diffYear(y, prevList, entries, isNew);
    if (change.added.length > 0 || change.removed.length > 0 || isNew) changes.push(change);
  }

  if (changes.length === 0) return finish(EXIT.OK);

  const merged: Record<string, unknown> = { ...(raw.years as Record<string, unknown>) };
  for (const [y, entries] of accepted) merged[String(y)] = entries;
  const sortedYears = Object.fromEntries(
    Object.keys(merged)
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => [k, merged[k]]),
  );
  const coversYears = [...new Set([...old.covers_years, ...accepted.keys()])].sort((a, b) => a - b);
  const generatedAt = formatDate(todayKst(ctx.clock));
  const next: Record<string, unknown> = {
    ...raw,
    source: "kasi-api",
    generated_at: generatedAt,
    covers_years: coversYears,
    years: sortedYears,
  };

  try {
    validateDataset("holidays", next, basis);
  } catch (e) {
    if (e instanceof DataValidationError) return finish(EXIT.UNAVAILABLE, [`스키마 검증 실패: ${e.issues.join("; ")}`]);
    throw e;
  }

  const summary = buildHolidaySummary(changes, rejected, old.generated_at, generatedAt);
  return { ...finish(EXIT.CHANGED), next, summary };
}

export async function main(argv: readonly string[], io: ScriptIO, deps?: { basis?: BasisDocuments }): Promise<number> {
  const sc = createScriptContext(io);
  const parsed = parseFlags(argv, ["--file", "--years", "--summary-out"]);
  if ("error" in parsed) {
    sc.err(`${USAGE}\n${parsed.error}\n`);
    return EXIT.USAGE;
  }
  const rawYears = parsed.flags["--years"];
  if (
    rawYears !== undefined &&
    (!/^\d{4}(,\d{4})*$/.test(rawYears) || rawYears.split(",").some((y) => Number(y) < 2000 || Number(y) > 2100))
  ) {
    sc.err(`${USAGE}\n--years는 YYYY 형식 연도를 쉼표로 나열하고 2000~2100 사이여야 합니다\n`);
    return EXIT.USAGE;
  }
  try {
    const file = parsed.flags["--file"] ?? join(findDataDir(), "holidays.json");
    const basis = deps?.basis ?? loadData("basis-documents");
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
      validateDataset("holidays", raw, basis);
    } catch (err) {
      sc.err(`데이터 파일을 읽을 수 없거나 검증에 실패했습니다: ${err instanceof Error ? err.message : String(err)}\n`);
      return EXIT.UNAVAILABLE;
    }
    const years = rawYears !== undefined ? rawYears.split(",").map(Number) : defaultYears(io.now());
    const result = await runRefresh(sc.ctx, raw, years, basis);
    sc.err(result.log);
    if (result.exitCode === EXIT.CHANGED && result.next !== undefined && result.summary !== undefined) {
      writeFileSync(file, serializeHolidays(result.next), "utf8");
      const summary = sc.mask(result.summary);
      const summaryOut = parsed.flags["--summary-out"];
      if (summaryOut !== undefined) writeFileSync(summaryOut, summary, "utf8");
      else sc.out(summary);
    }
    return result.exitCode;
  } catch (err) {
    sc.err(`확인 불가: 내부 오류 ${err instanceof Error ? err.message : String(err)}\n`);
    return EXIT.UNAVAILABLE;
  }
}

if (isMainModule(import.meta.url)) void main(process.argv.slice(2), processIO()).then((c) => { process.exitCode = c; });
