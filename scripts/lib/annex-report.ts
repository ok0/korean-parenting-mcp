import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BasisDoc } from "../../src/data-store/schema.js";
import type { RevisionStatus } from "../../src/provenance/revision-check.js";
import {
  ANNEX_REASON_TEXT,
  type AnnexFailReason,
  type AnnexLimits,
  downloadAttachment,
  safeAttachmentUrl,
  sniffFormat,
} from "./annex-fetch.js";
import { clampLines, diffLines, fenced, formatDiff } from "./annex-diff.js";
import { extractPdfText, normalizeText } from "./annex-text.js";

export const ANNEX_BUDGET = { perDocChars: 12_000, bodyMaxChars: 60_000 } as const;

export const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type AnnexResult =
  | {
      basisId: string;
      title: string;
      pageLink: string;
      attachmentLink?: string;
      kind: "text";
      text: string;
      textTruncated: boolean;
      previous?: string;
    }
  | {
      basisId: string;
      title: string;
      pageLink: string;
      attachmentLink?: string;
      kind: "unavailable";
      reason: AnnexFailReason;
    };

export interface CollectOptions {
  fetch: typeof fetch;
  baselineDir?: string;
  limits: AnnexLimits;
  mask: (t: string) => string;
  log: (line: string) => void;
}

export function readBaseline(dir: string, basisId: string, maxChars: number): string | undefined {
  if (!SAFE_ID.test(basisId)) return undefined;
  try {
    const file = join(dir, `${basisId}.txt`);
    if (statSync(file).size > maxChars * 4) return undefined;
    const text = normalizeText(readFileSync(file, "utf8"));
    return text === "" ? undefined : text;
  } catch {
    return undefined;
  }
}

export function writeBaselines(dir: string, results: readonly AnnexResult[], mask: (t: string) => string): number {
  mkdirSync(dir, { recursive: true });
  let count = 0;
  for (const r of results) {
    if (r.kind === "text" && SAFE_ID.test(r.basisId)) {
      writeFileSync(join(dir, `${r.basisId}.txt`), `${mask(r.text)}\n`, "utf8");
      count++;
    }
  }
  return count;
}

export async function collectAnnexes(
  statuses: readonly RevisionStatus[],
  docs: readonly BasisDoc[],
  opts: CollectOptions,
): Promise<AnnexResult[]> {
  const results: AnnexResult[] = [];
  for (const status of statuses) {
    if (status.state !== "changed") continue;
    const basisId = status.basisId;
    const doc = docs.find((d) => d.id === basisId);
    const title = doc?.title ?? basisId;
    const pageLink = status.link ?? doc?.url ?? "-";
    const url = safeAttachmentUrl(status.attachment?.pdfLink ?? status.attachment?.fileLink);
    const attachmentLink = url?.href;
    const base = { basisId, title, pageLink, attachmentLink };
    const fail = (reason: AnnexFailReason): void => {
      opts.log(`첨부 ${basisId}: 추출 불가 — ${ANNEX_REASON_TEXT[reason]}`);
      results.push({ ...base, kind: "unavailable", reason });
    };
    if (url === undefined) {
      fail("no_url");
      continue;
    }
    try {
      const dl = await downloadAttachment(url, opts.fetch, opts.limits);
      if (!dl.ok) {
        fail(dl.reason);
        continue;
      }
      const format = sniffFormat(dl.bytes, dl.contentType);
      if (format === "hwp") {
        fail("hwp");
        continue;
      }
      if (format === "html") {
        fail("blocked");
        continue;
      }
      if (format !== "pdf") {
        fail("unsupported");
        continue;
      }
      const extracted = await extractPdfText(dl.bytes, { maxChars: opts.limits.maxChars });
      if (!extracted.ok) {
        fail(extracted.reason);
        continue;
      }
      const text = normalizeText(opts.mask(extracted.text));
      const prior = opts.baselineDir !== undefined ? readBaseline(opts.baselineDir, basisId, opts.limits.maxChars) : undefined;
      const previous = prior !== undefined ? opts.mask(prior) : undefined;
      opts.log(`첨부 ${basisId}: 추출 ${text.split("\n").length}줄`);
      results.push({ ...base, kind: "text", text, textTruncated: extracted.truncated, previous });
    } catch {
      fail("extract_failed");
    }
  }
  return results;
}

export function assembleIssueBody(
  base: string,
  results: readonly AnnexResult[],
  budget: { perDocChars: number; bodyMaxChars: number } = ANNEX_BUDGET,
): string {
  if (results.length === 0) return base;
  const per = Math.min(
    budget.perDocChars,
    Math.floor((budget.bodyMaxChars - base.length - 500) / results.length) - 400,
  );
  const parts: string[] = [base.endsWith("\n") ? base : `${base}\n`];
  parts.push("", "## 첨부 텍스트 비교", "자동 추출한 참고 텍스트입니다. 표·서식은 손실될 수 있으니 반드시 원문으로 확인하세요.", "");
  for (const r of results) {
    const lines: string[] = [
      `### ${r.title} (\`${r.basisId}\`)`,
      `- 원문: ${r.pageLink}`,
      r.attachmentLink !== undefined ? `- 첨부: <${r.attachmentLink}>` : "- 첨부: 없음",
    ];
    if (r.kind === "unavailable") {
      lines.push(`- 결과: 추출 불가 — ${ANNEX_REASON_TEXT[r.reason]}`);
      lines.push(`- 원문에서 직접 확인하세요: ${r.attachmentLink ?? r.pageLink}`);
    } else {
      const textLines = r.text.split("\n");
      const omitted = per < 200;
      let resultLine: string;
      let block: string | undefined;
      let clipped: { shown: number; total: number; truncated: boolean } | undefined;
      if (r.previous !== undefined) {
        const d = diffLines(r.previous.split("\n"), textLines);
        if (d.hunks.length > 0) {
          resultLine = `- 결과: 이전 텍스트 대비 변경(추가 ${d.added}줄 · 삭제 ${d.removed}줄)${d.approximate ? " · 근사 비교" : ""}`;
          if (!omitted) {
            const c = clampLines(formatDiff(d), per);
            block = fenced(c.text, "diff");
            clipped = c;
          }
        } else {
          resultLine = "- 결과: 직전 실행에서 저장한 텍스트와 동일(이 이슈의 최초 본문 diff를 참고하세요)";
        }
      } else {
        resultLine = "- 결과: 비교 기준 없음(이전 실행의 추출 텍스트가 없음). 새 텍스트 발췌:";
        if (!omitted) {
          const c = clampLines(textLines, per);
          block = fenced(c.text, "text");
          clipped = c;
        }
      }
      lines.push(resultLine);
      if (omitted && block === undefined && !resultLine.startsWith("- 결과: 직전 실행")) {
        lines.push("> 본문 길이 상한으로 내용을 생략했습니다. 원문 링크에서 확인하세요.");
      }
      if (block !== undefined) lines.push(block);
      if (clipped !== undefined && clipped.truncated) {
        lines.push(`> 잘림: 전체 ${clipped.total}줄 중 ${clipped.shown}줄만 표시했습니다. 전체 내용은 원문 링크에서 확인하세요.`);
      }
      if (r.textTruncated) lines.push("> 추출 텍스트가 상한을 넘어 앞부분만 비교했습니다.");
    }
    parts.push(lines.join("\n"), "");
  }
  const body = parts.join("\n");
  if (body.length > budget.bodyMaxChars) {
    return `${body.slice(0, budget.bodyMaxChars - 60)}\n\n> 본문 길이 상한으로 잘렸습니다.\n`;
  }
  return body;
}
