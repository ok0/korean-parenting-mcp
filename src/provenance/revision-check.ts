import { createLawClient, normName, type AdmrulRow, type LawClient, type LicbylRow, type LawRow } from "../clients/law.js";
import type { ToolContext } from "../core/context.js";
import { ToolError } from "../core/errors.js";
import { resolveBasis } from "../data-store/load.js";
import type { BasisDoc, LawApiKey } from "../data-store/schema.js";

export type RevisionState = "confirmed" | "changed" | "unavailable" | "skipped";
export type UnavailableReason = "no_baseline" | "not_found" | "ambiguous" | "deadline" | "timeout" | "failed" | "bad_response";

export interface RevisionStatus {
  basisId: string;
  state: RevisionState;
  message: string;
  reason?: UnavailableReason;
  link?: string;
  stored?: Record<string, string>;
  current?: Record<string, string>;
}

export const REVISION_TEXT = {
  skippedNoOc: "법제처 OC 미설정: 개정 여부 확인 생략",
  skippedNoApi: "자동 확인 대상 아님",
  confirmed: "원문 확인됨",
  changed: "근거가 개정되었습니다. 원문을 확인하세요",
  unavailable: "개정 여부 확인 불가",
} as const;

export const UNAVAILABLE_TEXT: Record<UnavailableReason, string> = {
  no_baseline: "비교 기준 미등록",
  not_found: "조회 결과에 대상 없음",
  ambiguous: "같은 이름 행정규칙이 여러 건",
  deadline: "확인 시간 초과",
  timeout: "법제처 응답 시간 초과",
  failed: "법제처 조회 실패",
  bad_response: "응답 형식 오류",
};

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

function skipped(basisId: string, message: string): RevisionStatus {
  return { basisId, state: "skipped", message };
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
    const wantNo = String(Number(key.annex_no.replace(/\D/g, "")));
    const row = rows.find(
      (r) =>
        (r.lawName === undefined || normName(r.lawName) === normName(key.law_name)) &&
        String(Number(r.annexNo?.replace(/\D/g, "") || NaN)) === wantNo,
    );
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
  if (key === null) return skipped(doc.id, REVISION_TEXT.skippedNoApi);
  if (!ctx.config.keys.LAW_OC) return skipped(doc.id, REVISION_TEXT.skippedNoOc);
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
    return status;
  } catch (err) {
    const kind = err instanceof ToolError ? err.kind : "INTERNAL";
    ctx.log.info("revision check failed", { basisId: doc.id, kind });
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
