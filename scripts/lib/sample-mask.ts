import { maskSecrets } from "../../src/core/secrets.js";
import { DATA_GO_KR_OK_CODES } from "../../src/core/errors.js";

export const KEY_ENV_NAMES = ["DATA_GO_KR_SERVICE_KEY", "LAW_OC", "KINDERGARTEN_API_KEY", "SAFETYKOREA_AUTH_KEY"] as const;
export const PLACEHOLDER_KEY = "INVALID-PLACEHOLDER-KEY";
export const MASK = "***";

const PARAM_RE = /((?:^|[?&;])(?:servicekey|oc|authkey|key)=)([^&"'<>\s]*)/gi;
const NON_LEAK_VALUES: ReadonlySet<string> = new Set([MASK, "%2A%2A%2A", "test", ""]);
const HEX64_RE = /\b[0-9a-fA-F]{64}\b/;
const BASE64_RE = /[A-Za-z0-9+\/]{60,}={1,2}/;
const BASE64_ENCODED_RE = /(?:[A-Za-z0-9]|%2[BbFf]){60,}%3[Dd]/;

function unique(xs: readonly string[]): string[] {
  return [...new Set(xs)];
}

function lowerPct(s: string): string {
  return s.replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase());
}

function rawVariants(s: string): string[] {
  const enc = encodeURIComponent(s);
  const form = new URLSearchParams({ k: s }).toString().slice(2);
  return unique([s, enc, form, lowerPct(enc), lowerPct(form), encodeURIComponent(enc)]);
}

export function secretsFromEnv(env: Record<string, string | undefined>): string[] {
  const out: string[] = [];
  for (const name of KEY_ENV_NAMES) {
    const v = env[name];
    if (v && v.replace(/\s/g, "").length >= 1) out.push(v);
  }
  return out;
}

export function secretVariants(s: string): string[] {
  return rawVariants(s).sort((a, b) => b.length - a.length);
}

export function maskSample(text: string, secrets: readonly string[]): string {
  const variants = unique(secrets.flatMap((s) => rawVariants(s)))
    .filter((v) => v.length > 0)
    .sort((a, b) => b.length - a.length);
  let out = maskSecrets(text, secrets);
  for (const v of variants) out = out.split(v).join(MASK);
  return out.replace(PARAM_RE, (m: string, p1: string, p2: string) =>
    p2 === MASK || p2 === "test" ? m : p1 + MASK,
  );
}

export type LeakRule = string;

export function findLeaks(
  text: string,
  secrets: readonly string[],
  opts?: { heuristic?: boolean },
): LeakRule[] {
  const labels: LeakRule[] = [];
  secrets.forEach((s, i) => {
    rawVariants(s).forEach((v, j) => {
      if (v.length > 0 && text.includes(v)) labels.push(`secret#${i}:${j}`);
    });
  });
  for (const m of text.matchAll(PARAM_RE)) {
    const value = m[2] ?? "";
    if (!NON_LEAK_VALUES.has(value)) {
      const name = (m[1] ?? "").replace(/^[?&;]/, "").slice(0, -1).toLowerCase();
      labels.push(`param:${name}`);
    }
  }
  if (opts?.heuristic) {
    if (HEX64_RE.test(text)) labels.push("hex64");
    if (BASE64_RE.test(text)) labels.push("base64");
    if (BASE64_ENCODED_RE.test(text)) labels.push("base64-encoded");
  }
  return unique(labels).sort();
}

export type SampleFormat = "xml" | "json" | "html" | "text";

export function detectFormat(text: string, contentType: string): SampleFormat {
  const body = text.trimStart();
  if (/^<(!doctype html|html)/i.test(body) || contentType.toLowerCase().includes("text/html")) return "html";
  if (body.startsWith("<")) return "xml";
  if (body.startsWith("{") || body.startsWith("[")) return "json";
  return "text";
}

interface Hit {
  parent: Record<string, unknown>;
  key: string;
  value: unknown;
}

function bfsFind(root: unknown, maxDepth: number, pred: (k: string, v: unknown) => boolean): Hit | undefined {
  let level: unknown[] = [root];
  for (let depth = 0; depth <= maxDepth && level.length > 0; depth++) {
    const next: unknown[] = [];
    for (const node of level) {
      if (node === null || typeof node !== "object") continue;
      const rec = node as Record<string, unknown>;
      for (const [k, v] of Object.entries(rec)) {
        if (pred(k, v)) return { parent: rec, key: k, value: v };
        next.push(v);
      }
    }
    level = next;
  }
  return undefined;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function trimXml(text: string, max: number, itemsKey: string): { text: string; before: number; after: number } {
  const k = escapeRe(itemsKey);
  const re = new RegExp(`\\s*<${k}(\\s[^>]*)?>[\\s\\S]*?</${k}>`, "g");
  let before = 0;
  let kept = 0;
  const out = text.replace(re, (m: string) => {
    before++;
    if (kept < max) {
      kept++;
      return m;
    }
    return "";
  });
  return { text: out, before, after: kept };
}

function trimJson(text: string, max: number, itemsKey: string): { text: string; before: number; after: number } {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return { text, before: -1, after: -1 };
  }
  const hit = bfsFind(root, 6, (k, v) => k === itemsKey && Array.isArray(v));
  if (!hit) return { text, before: -1, after: -1 };
  const arr = hit.value as unknown[];
  const after = Math.min(arr.length, max);
  if (after === arr.length) return { text, before: arr.length, after };
  hit.parent[hit.key] = arr.slice(0, max);
  return { text: JSON.stringify(root, null, 2), before: arr.length, after };
}

export function trimItems(
  text: string,
  format: SampleFormat,
  max: number,
  itemsKey = "item",
): { text: string; before: number; after: number } {
  if (max <= 0 || (format !== "xml" && format !== "json")) return { text, before: -1, after: -1 };
  if (format === "xml") return trimXml(text, max, itemsKey);
  return trimJson(text, max, itemsKey);
}

export type Classification = "확인됨" | "미승인" | "한도·장애" | "기타 오류";

export interface SampleSummary {
  status: number | null;
  contentType: string;
  format: SampleFormat;
  bytes: number;
  code?: string;
  totalCount?: string;
  classification: Classification;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function pick(o: unknown, path: readonly string[]): unknown {
  let cur = o;
  for (const p of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function scalar(v: unknown): string | undefined {
  return typeof v === "string" || typeof v === "number" ? String(v) : undefined;
}

function xmlTag(text: string, tag: string): string | undefined {
  const m = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(text);
  return m ? (m[1] ?? "").trim() : undefined;
}

function extractCode(text: string, format: SampleFormat): string | undefined {
  if (format === "xml") return xmlTag(text, "returnReasonCode") ?? xmlTag(text, "resultCode");
  if (format === "json") {
    const o = parseJson(text);
    return (
      scalar(pick(o, ["OpenAPI_ServiceResponse", "cmmMsgHeader", "returnReasonCode"])) ??
      scalar(pick(o, ["response", "header", "resultCode"])) ??
      scalar(pick(o, ["resultCode"])) ??
      scalar(pick(o, ["code"]))
    );
  }
  return undefined;
}

function extractTotal(text: string, format: SampleFormat): string | undefined {
  if (format === "xml") return xmlTag(text, "totalCount");
  if (format === "json") {
    const hit = bfsFind(
      parseJson(text),
      4,
      (k, v) => (k === "totalCount" || k === "totalCnt") && (typeof v === "string" || typeof v === "number"),
    );
    return hit ? scalar(hit.value) : undefined;
  }
  return undefined;
}

function classify(text: string, status: number | null, format: SampleFormat, code: string | undefined): Classification {
  if (status === null || status === 429 || status === 503 || status === 504) return "한도·장애";
  if (code === "20" || code === "30" || /사용자\s*정보\s*검증에?\s*실패/.test(text)) return "미승인";
  if (code === "22" || code === "23") return "한도·장애";
  if (status === 200 && format !== "html" && (code === undefined || DATA_GO_KR_OK_CODES.has(code))) return "확인됨";
  return "기타 오류";
}

export function summarize(text: string, status: number | null, contentType: string): SampleSummary {
  const format = detectFormat(text, contentType);
  const code = extractCode(text, format);
  const totalCount = extractTotal(text, format);
  const summary: SampleSummary = {
    status,
    contentType,
    format,
    bytes: Buffer.byteLength(text, "utf8"),
    classification: classify(text, status, format, code),
  };
  if (code !== undefined) summary.code = code;
  if (totalCount !== undefined) summary.totalCount = totalCount;
  return summary;
}
