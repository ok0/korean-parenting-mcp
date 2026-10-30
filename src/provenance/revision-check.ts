import { createLawClient, normName, parseAnnexNo, type AdmrulRow, type LawClient, type LicbylRow, type LawRow } from "../clients/law.js";
import type { ToolContext } from "../core/context.js";
import { ToolError } from "../core/errors.js";
import { resolveBasis } from "../data-store/load.js";
import type { BasisDoc, LawApiKey } from "../data-store/schema.js";
import { REVISION_TEXT, UNAVAILABLE_TEXT, skippedStatus, type RevisionState, type RevisionStatus, type UnavailableReason } from "./revision-text.js";
export { REVISION_TEXT, UNAVAILABLE_TEXT, keylessStatus, skippedStatus, type RevisionState, type RevisionStatus, type UnavailableReason } from "./revision-text.js";

const FIELD_LABELS: Record<string, string> = {
  serial: "일련번호",
  number: "발령번호",
  promulgated: "공포일자",
  promulgation_no: "공포번호",
  mst: "MST",
  effective: "시행일",
};

export function storedFields(key: LawApiKey): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (name: string, value: string | undefined): void => {
    if (value !== undefined) out[name] = value;
  };
  if (key.kind === "admrul") {
    put("serial", key.serial);
    put("number", key.number);
  } else if (key.kind === "licbyl") {
    put("promulgated", key.promulgated);
    put("promulgation_no", key.promulgation_no);
  } else {
    put("mst", key.mst);
    put("effective", key.effective);
  }
  return out;
}

function rowFields(kind: LawApiKey["kind"], row: AdmrulRow | LicbylRow | LawRow): Record<string, string | undefined> {
  if (kind === "admrul") {
    const r = row as AdmrulRow;
    return { serial: r.serial, number: r.number };
  }
  if (kind === "licbyl") {
    const r = row as LicbylRow;
    return { promulgated: r.promulgated, promulgation_no: r.promulgationNo };
  }
  const r = row as LawRow;
  return { mst: r.mst, effective: r.effective };
}

function fmt(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([k, v]) => `${FIELD_LABELS[k] ?? k} ${v}`)
    .join(", ");
}

function digits(v: string): string {
  return v.replace(/\D/g, "");
}

export function compareKey(stored: LawApiKey, row: AdmrulRow | LicbylRow | LawRow): "same" | "changed" | "no_baseline" | "incomparable" {
  const s = storedFields(stored);
  const storedKeys = Object.keys(s);
  if (storedKeys.length === 0) return "no_baseline";
  const current = rowFields(stored.kind, row);
  const comparable = storedKeys.filter((k) => current[k] !== undefined);
  if (comparable.length === 0) return "incomparable";
  const differs = comparable.some((k) => digits(s[k] ?? "") !== digits(current[k] ?? ""));
  return differs ? "changed" : "same";
}

function unavailable(basisId: string, reason: UnavailableReason): RevisionStatus {
  return { basisId, state: "unavailable", reason, message: `${REVISION_TEXT.unavailable}(${UNAVAILABLE_TEXT[reason]})` };
}

type FindResult = { row: AdmrulRow | LicbylRow | LawRow } | { reason: UnavailableReason };

async function findRow(key: LawApiKey, client: LawClient): Promise<FindResult> {
  if (key.kind === "admrul") {
    const rows = await client.searchAdmrul(key.name);
    const matches = key.rule_id
      ? rows.filter((r) => r.ruleId === key.rule_id)
      : rows.filter((r) => r.name !== undefined && normName(r.name) === normName(key.name));
    if (matches.length > 1) return { reason: "ambiguous" };
    const row = matches[0];
    return row ? { row } : { reason: "not_found" };
  }
  if (key.kind === "licbyl") {
    const rows = await client.searchLicbyl(key.law_name);
    const want = parseAnnexNo(key.annex_no);
    if (!want) return { reason: "not_found" };
    const row = rows.find((r) => {
      if (!((r.lawName === undefined || normName(r.lawName) === normName(key.law_name)) && (r.kind === undefined || r.kind === "별표"))) return false;
      const got = parseAnnexNo(r.annexNo);
      return got !== undefined && got.no === want.no && got.branch === want.branch;
    });
    return row ? { row } : { reason: "not_found" };
  }
  const rows = await client.searchLaw(key.law_name);
  const row = key.law_id
    ? rows.find((r) => r.lawId === key.law_id)
    : rows.find((r) => r.name !== undefined && normName(r.name) === normName(key.law_name));
  return row ? { row } : { reason: "not_found" };
}

async function checkOne(doc: BasisDoc, ctx: ToolContext, client: LawClient | undefined): Promise<RevisionStatus> {
  const key = doc.law_api;
  if (key === null) return skippedStatus(doc.id, REVISION_TEXT.skippedNoApi);
  if (!ctx.config.keys.LAW_OC) return skippedStatus(doc.id, REVISION_TEXT.skippedNoOc);
  const stored = storedFields(key);
  if (Object.keys(stored).length === 0) return unavailable(doc.id, "no_baseline");
  if (client === undefined) return unavailable(doc.id, "failed");
  try {
    const found = await findRow(key, client);
    if ("reason" in found) return unavailable(doc.id, found.reason);
    const verdict = compareKey(key, found.row);
    if (verdict === "same") return { basisId: doc.id, state: "confirmed", message: REVISION_TEXT.confirmed };
    if (verdict === "incomparable") return unavailable(doc.id, "bad_response");
    if (verdict === "no_baseline") return unavailable(doc.id, "no_baseline");
    const values = rowFields(key.kind, found.row);
    const current: Record<string, string> = {};
    for (const k of Object.keys(stored)) {
      const v = values[k];
      if (v !== undefined) current[k] = v;
    }
    const status: RevisionStatus = {
      basisId: doc.id,
      state: "changed",
      message: `${REVISION_TEXT.changed} (저장 ${fmt(stored)} → 현재 ${fmt(current)})`,
      stored,
      current,
    };
    if (found.row.link !== undefined) status.link = found.row.link;
    if (key.kind === "licbyl") {
      const r = found.row as LicbylRow;
      const attachment: { pdfLink?: string; fileLink?: string } = {};
      if (r.pdfLink !== undefined) attachment.pdfLink = r.pdfLink;
      if (r.fileLink !== undefined) attachment.fileLink = r.fileLink;
      if (Object.keys(attachment).length > 0) status.attachment = attachment;
    }
    return status;
  } catch (err) {
    const kind = err instanceof ToolError ? err.kind : "INTERNAL";
    ctx.log.info("revision check failed", { basisId: doc.id, kind });
    if (err instanceof ToolError && err.kind === "NOT_APPROVED") return unavailable(doc.id, "not_approved");
    if (err instanceof ToolError && err.kind === "TIMEOUT") return unavailable(doc.id, "timeout");
    if (err instanceof ToolError && err.detail?.reason === "format") return unavailable(doc.id, "bad_response");
    return unavailable(doc.id, "failed");
  }
}

function summarize(ctx: ToolContext, results: readonly RevisionStatus[], started: number): void {
  const count = (state: RevisionState): number => results.filter((r) => r.state === state).length;
  ctx.log.debug("revision check", {
    confirmed: count("confirmed"),
    changed: count("changed"),
    unavailable: count("unavailable"),
    skipped: count("skipped"),
    ms: Date.now() - started,
  });
}

export async function checkRevisionDocs(
  docs: readonly BasisDoc[],
  ctx: ToolContext,
  opts?: { deadlineMs?: number; client?: LawClient },
): Promise<RevisionStatus[]> {
  const started = Date.now();
  if (ctx.revisionCheck === "remote-unavailable") {
    const out = docs.map((d) => skippedStatus(d.id, REVISION_TEXT.skippedRemote, d.url));
    summarize(ctx, out, started);
    return out;
  }
  const deadlineMs = opts?.deadlineMs ?? ctx.config.lawCheckTimeoutMs;
  try {
    const client = ctx.config.keys.LAW_OC
      ? (opts?.client ?? createLawClient(ctx, { timeoutMs: Math.min(ctx.config.httpTimeoutMs, deadlineMs) }))
      : undefined;
    const results: (RevisionStatus | undefined)[] = docs.map(() => undefined);
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, deadlineMs);
      timer.unref?.();
    });
    const tasks = docs.map(async (doc, i) => {
      const status = await checkOne(doc, ctx, client);
      if (!closed) results[i] = status;
    });
    try {
      await Promise.race([Promise.all(tasks), deadline]);
    } finally {
      closed = true;
      clearTimeout(timer);
    }
    const out = docs.map((doc, i) => results[i] ?? unavailable(doc.id, "deadline"));
    summarize(ctx, out, started);
    return out;
  } catch {
    const out = docs.map((doc) => unavailable(doc.id, "failed"));
    summarize(ctx, out, started);
    return out;
  }
}

export const ISSUE_MARKER = "<!-- kpm:revision-check -->";

export function kstStamp(d: Date): string {
  const s = new Date(d.getTime() + 9 * 3600_000).toISOString();
  return `${s.slice(0, 10)} ${s.slice(11, 16)} KST`;
}

export function buildIssueBody(statuses: readonly RevisionStatus[], docs: readonly BasisDoc[], checkedAt: Date): string {
  const count = (state: RevisionState): number => statuses.filter((s) => s.state === state).length;
  const lines: string[] = [
    ISSUE_MARKER,
    "# 근거 문서 개정 감지",
    "",
    `확인 시각: ${kstStamp(checkedAt)}`,
    `변경 ${count("changed")}건 · 확인 불가 ${count("unavailable")}건 · 확인됨 ${count("confirmed")}건`,
    "",
    "## 변경된 문서",
  ];
  for (const s of statuses.filter((x) => x.state === "changed")) {
    const doc = docs.find((d) => d.id === s.basisId);
    const title = doc?.title ?? s.basisId;
    const docNo = doc?.doc_no ?? "-";
    const url = doc?.url ?? "-";
    lines.push(
      `### ${title} (\`${s.basisId}\`)`,
      `- 문서 번호: ${docNo}`,
      `- 저장값: ${fmt(s.stored ?? {})}`,
      `- 현재값: ${fmt(s.current ?? {})}`,
      `- 원문: ${s.link ?? `${url} (응답에 상세 링크 없음, 등록된 URL)`}`,
      "",
    );
  }
  lines.push("## 확인 불가 문서");
  const unavailableStatuses = statuses.filter((s) => s.state === "unavailable");
  if (unavailableStatuses.length === 0) {
    lines.push("- 없음");
  }
  for (const s of unavailableStatuses) {
    const title = docs.find((d) => d.id === s.basisId)?.title ?? s.basisId;
    lines.push(`- ${title} (\`${s.basisId}\`): ${s.message}`);
  }
  lines.push(
    "",
    "## 후속 조치",
    "- [ ] 원문을 열어 개정 내용(공포일·시행일·조문)을 확인",
    "- [ ] `data/basis-documents.json`의 해당 문서 `law_api` 식별값·개정일·`as_of` 갱신",
    "- [ ] 이 문서를 근거로 하는 정적 일정 데이터(`data/*.json`)를 원문과 대조하고 필요하면 수정 PR 작성",
    "- [ ] 확인 불가 문서는 원문을 수동으로 대조",
  );
  return lines.join("\n") + "\n";
}

export async function checkRevisions(
  basisIds: readonly string[],
  ctx: ToolContext,
  opts?: { deadlineMs?: number },
): Promise<RevisionStatus[]> {
  try {
    return await checkRevisionDocs(resolveBasis(basisIds), ctx, opts);
  } catch {
    return basisIds.map((id) => unavailable(id, "failed"));
  }
}
