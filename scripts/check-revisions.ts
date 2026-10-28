import { writeFileSync } from "node:fs";
import type { ToolContext } from "../src/core/context.js";
import { loadData } from "../src/data-store/load.js";
import type { BasisDoc } from "../src/data-store/schema.js";
import {
  buildIssueBody,
  checkRevisionDocs,
  type RevisionStatus,
  type UnavailableReason,
} from "../src/provenance/revision-check.js";
import { createScriptContext, EXIT, isMainModule, parseFlags, processIO, type ScriptIO } from "./lib/script-io.js";

export const REASON_LABEL = {
  oc_missing: "OC 미설정(LAW_OC 환경변수 없음)",
  not_approved: "사용자 정보 검증 실패(OC·IP 등록 확인)",
  upstream: "응답 형식 오류·장애",
  no_baseline: "비교 기준 미등록",
  unidentified: "대상 식별 실패(조회 결과 없음·중복)",
} as const;

export type ReasonCategory = keyof typeof REASON_LABEL;

const REASON_ORDER = Object.keys(REASON_LABEL) as ReasonCategory[];

export function reasonCategory(reason: UnavailableReason | undefined): Exclude<ReasonCategory, "oc_missing"> {
  if (reason === "not_approved") return "not_approved";
  if (reason === "no_baseline") return "no_baseline";
  if (reason === "not_found" || reason === "ambiguous") return "unidentified";
  return "upstream";
}

export function autoCheckTargets(docs: readonly BasisDoc[]): BasisDoc[] {
  return docs.filter((d) => d.law_api !== null);
}

export interface CheckRevisionsResult {
  exitCode: 0 | 2 | 10;
  statuses: RevisionStatus[];
  summary: string;
  issueBody?: string;
}

function labelsOf(categories: Iterable<ReasonCategory>): string[] {
  const set = new Set(categories);
  return REASON_ORDER.filter((k) => set.has(k)).map((k) => REASON_LABEL[k]);
}

function statusLine(s: RevisionStatus, docs: readonly BasisDoc[]): string {
  const title = docs.find((d) => d.id === s.basisId)?.title ?? s.basisId;
  const head = `${s.basisId} (${title})`;
  if (s.state === "confirmed") return `- 확인됨: ${head}`;
  if (s.state === "changed") return `- 변경: ${head} — ${s.message}`;
  if (s.state === "unavailable") return `- 확인 불가[${REASON_LABEL[reasonCategory(s.reason)]}]: ${head}`;
  return `- 생략: ${head}`;
}

function buildSummary(docs: readonly BasisDoc[], statuses: readonly RevisionStatus[], exitCode: number, result: string): string {
  const count = (state: RevisionStatus["state"]): number => statuses.filter((s) => s.state === state).length;
  const lines = [`개정 확인 대상 ${docs.length}건: 확인됨 ${count("confirmed")}, 변경 ${count("changed")}, 확인 불가 ${count("unavailable")}`];
  for (const s of statuses) lines.push(statusLine(s, docs));
  lines.push(`결과: 종료 ${exitCode} — ${result}`);
  return lines.join("\n") + "\n";
}

export async function runCheckRevisions(
  ctx: ToolContext,
  docs: readonly BasisDoc[],
  opts: { deadlineMs: number; now: Date },
): Promise<CheckRevisionsResult> {
  if (!ctx.config.keys.LAW_OC) {
    return {
      exitCode: EXIT.UNAVAILABLE,
      statuses: [],
      summary: buildSummary(docs, [], EXIT.UNAVAILABLE, `확인 불가: ${REASON_LABEL.oc_missing}`),
    };
  }
  const statuses = await checkRevisionDocs(docs, ctx, { deadlineMs: opts.deadlineMs });
  const changed = statuses.filter((s) => s.state === "changed").length;
  const unavailable = statuses.filter((s) => s.state === "unavailable");
  const exitCode: 0 | 2 | 10 = changed > 0 ? EXIT.CHANGED : unavailable.length > 0 ? EXIT.UNAVAILABLE : EXIT.OK;
  const result =
    exitCode === EXIT.CHANGED
      ? "변경 있음"
      : exitCode === EXIT.OK
        ? "변경 없음"
        : `확인 불가: ${labelsOf(unavailable.map((s) => reasonCategory(s.reason))).join(", ")}`;
  const out: CheckRevisionsResult = { exitCode, statuses, summary: buildSummary(docs, statuses, exitCode, result) };
  if (exitCode === EXIT.CHANGED) out.issueBody = buildIssueBody(statuses, docs, opts.now);
  return out;
}

export async function main(argv: readonly string[], io: ScriptIO, deps?: { docs?: readonly BasisDoc[] }): Promise<number> {
  const sc = createScriptContext(io);
  const usage = "사용법: node build-scripts/scripts/check-revisions.js [--out <path>] [--deadline-ms <n>]";
  const parsed = parseFlags(argv, ["--out", "--deadline-ms"]);
  if ("error" in parsed) {
    sc.err(`${usage}\n${parsed.error}\n`);
    return EXIT.USAGE;
  }
  const rawDeadline = parsed.flags["--deadline-ms"] ?? "60000";
  const deadlineMs = Number(rawDeadline);
  if (!/^\d+$/.test(rawDeadline) || deadlineMs < 100 || deadlineMs > 600000) {
    sc.err(`${usage}\n--deadline-ms는 100~600000 사이의 정수여야 합니다\n`);
    return EXIT.USAGE;
  }
  try {
    const docs = autoCheckTargets(deps?.docs ?? loadData("basis-documents").documents);
    const result = await runCheckRevisions(sc.ctx, docs, { deadlineMs, now: io.now() });
    sc.err(result.summary);
    if (result.exitCode === EXIT.CHANGED && result.issueBody !== undefined) {
      const body = sc.mask(result.issueBody);
      const outPath = parsed.flags["--out"];
      if (outPath !== undefined) writeFileSync(outPath, body, "utf8");
      else sc.out(body);
    }
    return result.exitCode;
  } catch (err) {
    sc.err(`확인 불가: 내부 오류 ${err instanceof Error ? err.message : String(err)}\n`);
    return EXIT.UNAVAILABLE;
  }
}

if (isMainModule(import.meta.url)) void main(process.argv.slice(2), processIO()).then((c) => { process.exitCode = c; });
