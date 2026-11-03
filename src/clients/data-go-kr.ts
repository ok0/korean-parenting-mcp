import { cached } from "../core/cache.js";
import type { ToolContext } from "../core/context.js";
import { DATA_GO_KR_OK_CODES, dataGoKrError, missingKeyError, ToolError } from "../core/errors.js";
import { httpGet } from "../core/http.js";
import { asArray, isRecord, parseBody, pick } from "./parse.js";

export interface ApiSpec {
  readonly id: string;
  readonly title: string;
  readonly datasetUrl: string;
  readonly attribution: string;
  readonly baseUrl: string;
  readonly operation: string;
  readonly formatParams?: Readonly<Record<string, string>>;
  readonly itemsPath: readonly string[];
  readonly totalCountPath?: readonly string[];
  readonly resultCodePath: readonly string[];
  readonly emptyCodes?: readonly string[]; // 이 결과 코드는 오류 대신 0건(HTTP 2xx일 때만, M56)
  readonly cacheTtlMs: number;
  readonly confirmed: boolean;
  readonly knownParams?: readonly string[];
  readonly note?: string;
}

export type DataGoKrParams = Record<string, string | number | undefined>;

export interface DataGoKrResult {
  items: Record<string, unknown>[];
  totalCount?: number;
  fromCache: boolean;
}

export const GATEWAY_CODE_PATH = ["OpenAPI_ServiceResponse", "cmmMsgHeader", "returnReasonCode"] as const;

export function dataGoKrCacheKey(spec: ApiSpec, params: DataGoKrParams): string {
  const sorted = Object.entries(params)
    .filter((e): e is [string, string | number] => e[1] !== undefined)
    .map(([k, v]) => [k, String(v)] as [string, string])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `dgk:${spec.id}?${new URLSearchParams(sorted).toString()}`;
}

function statusError(status: number): ToolError {
  if (status === 429) return new ToolError("RATE_LIMIT", "외부 서버 호출 한도 초과(HTTP 429)");
  return new ToolError("UPSTREAM", `외부 서버 오류(HTTP ${status})`);
}

function codeAt(body: unknown, path: readonly string[]): string | undefined {
  const v = pick(body, path);
  if (typeof v !== "string" && typeof v !== "number") return undefined;
  return String(v).trim();
}

function interpret(
  res: { status: number; contentType: string; text: string },
  spec: ApiSpec,
  ctx: ToolContext,
): { items: Record<string, unknown>[]; totalCount?: number } {
  const ok2xx = res.status >= 200 && res.status < 300;
  let body: unknown;
  try {
    body = parseBody(res.text, res.contentType);
  } catch (err) {
    if (!ok2xx) throw statusError(res.status);
    throw err;
  }
  const code = codeAt(body, GATEWAY_CODE_PATH) ?? codeAt(body, spec.resultCodePath);
  if (code !== undefined && ok2xx && spec.emptyCodes?.includes(code)) return { items: [], totalCount: 0 };
  if (code !== undefined && !DATA_GO_KR_OK_CODES.has(code)) {
    ctx.log.info("data.go.kr error", { spec: spec.id, code });
    throw dataGoKrError(code);
  }
  if (!ok2xx) throw statusError(res.status);
  const items = asArray(pick(body, spec.itemsPath)).filter(isRecord);
  const out: { items: Record<string, unknown>[]; totalCount?: number } = { items };
  if (spec.totalCountPath) {
    const tc = pick(body, spec.totalCountPath);
    if (typeof tc === "number") out.totalCount = tc;
    else if (typeof tc === "string" && /^\d+$/.test(tc.trim())) out.totalCount = Number(tc.trim());
  }
  return out;
}

export async function callDataGoKr(
  spec: ApiSpec,
  params: DataGoKrParams,
  ctx: ToolContext,
  opts: { retries?: number } = {},
): Promise<DataGoKrResult> {
  const key = ctx.config.keys.DATA_GO_KR;
  if (!key) throw missingKeyError(["DATA_GO_KR"]);
  if (spec.baseUrl === "" || spec.operation === "") {
    throw new ToolError("INTERNAL", `API 명세가 아직 확정되지 않았습니다: ${spec.title}`);
  }

  const fetchOnce = async () => {
    const url = new URL(`${spec.baseUrl.replace(/\/+$/, "")}/${spec.operation}`);
    url.searchParams.set("serviceKey", key);
    for (const [k, v] of Object.entries(spec.formatParams ?? {})) url.searchParams.set(k, v);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const res = await httpGet(url, ctx, { allowErrorStatus: true, ...(opts.retries === undefined ? {} : { retries: opts.retries }) });
    return interpret(res, spec, ctx);
  };

  const { value, fromCache } = await cached(ctx, dataGoKrCacheKey(spec, params), spec.cacheTtlMs, fetchOnce);
  ctx.log.debug("data.go.kr", { spec: spec.id, fromCache });
  return { ...value, fromCache };
}
