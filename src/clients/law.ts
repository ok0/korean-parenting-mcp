import type { ToolContext } from "../core/context.js";
import { ToolError, missingKeyError } from "../core/errors.js";
import { cached } from "../core/cache.js";
import { CACHE_TTL_MS } from "../core/cache-ttl.js";
import { httpGet } from "../core/http.js";

export const LAW_BASE = "https://www.law.go.kr/DRF/";

export interface AdmrulRow {
  serial?: string;
  ruleId?: string;
  name?: string;
  issued?: string;
  number?: string;
  effective?: string;
  link?: string;
}

export interface LicbylRow {
  annexNo?: string;
  name?: string;
  kind?: string;
  lawName?: string;
  promulgated?: string;
  promulgationNo?: string;
  link?: string;
  pdfLink?: string;
  fileLink?: string;
}

export interface LawRow {
  lawId?: string;
  mst?: string;
  name?: string;
  promulgated?: string;
  effective?: string;
  link?: string;
}

export interface ArticleRow {
  lawName?: string;
  articleNo?: string;
  title?: string;
  lines: string[];
  promulgated?: string;
  effective?: string;
  articleEffective?: string;
  branch?: string;
}

export interface LawClient {
  searchAdmrul(name: string): Promise<AdmrulRow[]>;
  searchLicbyl(lawName: string): Promise<LicbylRow[]>;
  searchLaw(name: string): Promise<LawRow[]>;
  getArticle(lawId: string, jo: string): Promise<ArticleRow>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  if (typeof v !== "string" && typeof v !== "number") return undefined;
  const s = String(v).trim();
  return s === "" ? undefined : s;
}

export function toJo(article: number, branch = 0): string {
  if (!Number.isInteger(article) || article < 1 || article > 9999) {
    throw new RangeError(`조문 번호 범위 오류: 조 ${article}`);
  }
  if (!Number.isInteger(branch) || branch < 0 || branch > 99) {
    throw new RangeError(`조문 번호 범위 오류: 가지 ${branch}`);
  }
  return String(article).padStart(4, "0") + String(branch).padStart(2, "0");
}

export function parseLawBody(text: string, contentType: string): unknown {
  const trimmed = text.trim();
  if (trimmed === "") {
    throw new ToolError("UPSTREAM", "법제처 응답 본문이 비어 있습니다", {
      actions: ["잠시 후 다시 시도하세요.", "계속되면 LAW_OC 값과 법제처 OPEN API 신청 상태를 확인하세요."],
    });
  }
  if (/사용자\s*정보\s*검증에?\s*실패/.test(trimmed)) {
    throw new ToolError("NOT_APPROVED", "법제처 사용자 정보 검증에 실패했습니다", {
      actions: [
        "LAW_OC 값(법제처 OPEN API 인증값)이 맞는지 확인하세요.",
        "open.law.go.kr의 OPEN API 신청에서 사용할 API 종류(법령·행정규칙·별표서식)가 체크되어 있는지 확인하세요.",
        "호출하는 서버의 공인 IP 또는 도메인이 등록되어 있는지 확인하세요.",
      ],
    });
  }
  if (trimmed.startsWith("<") || /text\/html/i.test(contentType)) {
    throw new ToolError("UPSTREAM", "법제처가 JSON 대신 HTML 페이지를 반환했습니다(HTTP 200)", {
      actions: ["요청 대상(법령명·조문 번호)과 LAW_OC 값을 확인하세요.", "잠시 후 다시 시도하세요."],
    });
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    throw new ToolError("UPSTREAM", "법제처 응답을 JSON으로 해석하지 못했습니다", {
      detail: { reason: "format" },
    });
  }
}

export function extractRows(json: unknown, itemKey: string): Record<string, unknown>[] {
  const queue: { node: unknown; depth: number }[] = [{ node: json, depth: 0 }];
  let hasTotal = false;
  for (let i = 0; i < queue.length; i++) {
    const { node, depth } = queue[i]!;
    if (isRecord(node)) {
      if (depth <= 2 && Object.hasOwn(node, "totalCnt")) hasTotal = true;
      if (Object.hasOwn(node, itemKey)) {
        const v = node[itemKey];
        if (Array.isArray(v)) return v.filter(isRecord);
        if (isRecord(v)) return [v];
      }
    }
    if (depth < 3) {
      if (isRecord(node)) {
        for (const v of Object.values(node)) queue.push({ node: v, depth: depth + 1 });
      } else if (Array.isArray(node)) {
        for (const v of node) queue.push({ node: v, depth: depth + 1 });
      }
    }
  }
  if (hasTotal) return [];
  throw new ToolError("UPSTREAM", "법제처 응답 형식을 인식할 수 없습니다", { detail: { reason: "format" } });
}

export function lawLink(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  let u: URL;
  try {
    u = new URL(raw, "https://www.law.go.kr");
  } catch {
    return undefined;
  }
  if (!(u.hostname === "law.go.kr" || u.hostname.endsWith(".law.go.kr"))) return undefined;
  for (const key of [...u.searchParams.keys()]) {
    if (key.toLowerCase() === "oc") u.searchParams.delete(key);
  }
  u.protocol = "https:";
  return u.href;
}

export function parseAnnexNo(raw: string | undefined): { no: number; branch: number } | undefined {
  const d = (raw ?? "").replace(/\D/g, "");
  if (d === "") return undefined;
  if (d.length === 6) return { no: Number(d.slice(0, 4)), branch: Number(d.slice(4)) };
  return { no: Number(d), branch: 0 };
}

export function normName(s: string): string {
  return s.replace(/\s/g, "").replace(/[·ㆍ・]/g, "ㆍ");
}

const SCALAR_FIELDS: Record<
  string,
  "lawName" | "articleNo" | "branch" | "title" | "promulgated" | "effective" | "articleEffective"
> = {
  법령명_한글: "lawName",
  법령명한글: "lawName",
  조문번호: "articleNo",
  조문가지번호: "branch",
  조문제목: "title",
  공포일자: "promulgated",
  시행일자: "effective",
  조문시행일자: "articleEffective",
};

const LINE_KEYS: ReadonlySet<string> = new Set(["조문내용", "항내용", "호내용", "목내용"]);

export function parseArticle(json: unknown): ArticleRow {
  const out: ArticleRow = { lines: [] };
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const x of node) walk(x);
      return;
    }
    if (!isRecord(node)) return;
    if (node["조문여부"] === "전문") return;
    for (const [k, v] of Object.entries(node)) {
      const field = SCALAR_FIELDS[k];
      if (field !== undefined && out[field] === undefined) {
        const s = str(v);
        if (s !== undefined) out[field] = s;
      }
      if (LINE_KEYS.has(k)) {
        for (const item of Array.isArray(v) ? v : [v]) {
          if (typeof item === "string" && item.trim() !== "") out.lines.push(item.trim());
        }
      }
      walk(v);
    }
  };
  walk(json);
  return out;
}

export function createLawClient(ctx: ToolContext, opts?: { timeoutMs?: number }): LawClient {
  async function call(op: "lawSearch.do" | "lawService.do", params: Record<string, string>): Promise<unknown> {
    const oc = ctx.config.keys.LAW_OC;
    if (!oc) throw missingKeyError(["LAW_OC"]);
    const url = new URL(op, LAW_BASE);
    url.searchParams.set("OC", oc);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await httpGet(url, ctx, { timeoutMs: opts?.timeoutMs });
    return parseLawBody(res.text, res.contentType);
  }

  function cacheKey(op: string, params: Record<string, string>): string {
    const sorted = Object.entries(params).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `law:${op}?${new URLSearchParams(sorted).toString()}`;
  }

  async function memo<T>(
    op: "lawSearch.do" | "lawService.do",
    params: Record<string, string>,
    extract: (json: unknown) => T,
  ): Promise<T> {
    if (!ctx.config.keys.LAW_OC) throw missingKeyError(["LAW_OC"]);
    const ttl = op === "lawService.do" ? CACHE_TTL_MS.lawArticle : CACHE_TTL_MS.lawRevision;
    const { value } = await cached(ctx, cacheKey(op, params), ttl, async () => extract(await call(op, params)));
    return value;
  }

  return {
    searchAdmrul(name) {
      return memo(
        "lawSearch.do",
        { target: "admrul", query: name, knd: "3", display: "100", type: "JSON" },
        (json) =>
          extractRows(json, "admrul").map((r) => ({
            serial: str(r["행정규칙일련번호"]),
            ruleId: str(r["행정규칙ID"]),
            name: str(r["행정규칙명"]),
            issued: str(r["발령일자"]),
            number: str(r["발령번호"]),
            effective: str(r["시행일자"]),
            link: lawLink(str(r["행정규칙상세링크"])),
          })),
      );
    },
    searchLicbyl(lawName) {
      return memo(
        "lawSearch.do",
        { target: "licbyl", search: "2", query: lawName, display: "100", type: "JSON" },
        (json) =>
          extractRows(json, "licbyl").map((r) => ({
            annexNo: str(r["별표번호"]),
            name: str(r["별표명"]),
            kind: str(r["별표종류"]),
            lawName: str(r["관련법령명"]),
            promulgated: str(r["공포일자"]),
            promulgationNo: str(r["공포번호"]),
            link: lawLink(str(r["별표법령상세링크"]) ?? str(r["별표서식PDF파일링크"])),
            pdfLink: lawLink(str(r["별표서식PDF파일링크"])),
            fileLink: lawLink(str(r["별표서식파일링크"])),
          })),
      );
    },
    searchLaw(name) {
      return memo(
        "lawSearch.do",
        { target: "law", query: name, display: "100", type: "JSON" },
        (json) =>
          extractRows(json, "law").map((r) => ({
            lawId: str(r["법령ID"]),
            mst: str(r["법령일련번호"]),
            name: str(r["법령명한글"]),
            promulgated: str(r["공포일자"]),
            effective: str(r["시행일자"]),
            link: lawLink(str(r["법령상세링크"])),
          })),
      );
    },
    getArticle(lawId, jo) {
      return memo(
        "lawService.do",
        { target: "lawjosub", ID: lawId, JO: jo, type: "JSON" },
        (json) => parseArticle(json),
      );
    },
  };
}
