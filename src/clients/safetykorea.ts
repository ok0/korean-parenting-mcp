import { CACHE_TTL_MS } from "../core/cache-ttl.js";
import { cached } from "../core/cache.js";
import type { ToolContext } from "../core/context.js";
import { missingKeyError, SAFETYKOREA_KEY_ACTIONS, safetyKoreaError, ToolError } from "../core/errors.js";
import { httpGet } from "../core/http.js";
import { asArray, isRecord, parseBody } from "./parse.js";

export type SkService = "recallList" | "fRecallList" | "overseasList" | "certificationList";
export interface SkSpec { readonly path: string; readonly title: string; readonly uidField: string; readonly productKey: string; readonly cacheTtlMs: number; readonly confirmed: boolean }
export interface SkResult { items: Record<string, unknown>[]; fromCache: boolean; capped: boolean }
export const SK_BASE_URL = "https://www.safetykorea.kr/openapi/api"; // 명세는 http:// 표기. HTTPS 응답 확인(research C1). HTTP 대체 없음
export const SK_MAX_ROWS = 1000;
export const SK_SPECS: Readonly<Record<SkService, SkSpec>> = {
  recallList:        { path: "recall/recallList.json",       title: "국내 리콜정보",           uidField: "recallUid",   productKey: "recallProductName", cacheTtlMs: CACHE_TTL_MS.recall, confirmed: false },
  fRecallList:       { path: "recall/fRecallList.json",      title: "국외 리콜정보",           uidField: "fRecallUid",  productKey: "recallProductName", cacheTtlMs: CACHE_TTL_MS.recall, confirmed: false },
  overseasList:      { path: "recall/overseasList.json",     title: "해외직구 안전성조사결과", uidField: "overseasUid", productKey: "productName",       cacheTtlMs: CACHE_TTL_MS.recall, confirmed: false },
  certificationList: { path: "cert/certificationList.json",  title: "KC 인증정보",             uidField: "certUid",     productKey: "productName",       cacheTtlMs: CACHE_TTL_MS.recall, confirmed: false },
};
export function safetyKoreaCacheKey(service: SkService, conditionKey: string, conditionValue: string): string {
  return `sk:${service}?${new URLSearchParams([["conditionKey", conditionKey], ["conditionValue", conditionValue]]).toString()}`;
}

function resultCodeOf(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;
  const v = body.resultCode;
  if (typeof v !== "string" && typeof v !== "number") return undefined;
  const s = String(v).trim();
  return s === "" ? undefined : s;
}

function statusError(status: number): ToolError {
  if (status === 401 || status === 403) {
    return new ToolError("KEY_INVALID", `SafetyKorea 인증 실패(HTTP ${status})`, { actions: SAFETYKOREA_KEY_ACTIONS });
  }
  if (status === 429) return new ToolError("RATE_LIMIT", "외부 서버 호출 한도 초과(HTTP 429)");
  return new ToolError("UPSTREAM", `외부 서버 오류(HTTP ${status})`);
}

function interpret(
  res: { status: number; contentType: string; text: string },
  service: SkService,
  ctx: ToolContext,
): Record<string, unknown>[] {
  const ok2xx = res.status >= 200 && res.status < 300;
  let body: unknown;
  try {
    body = parseBody(res.text, res.contentType);
  } catch (err) {
    if (!ok2xx) throw statusError(res.status);
    throw err;
  }
  const code = resultCodeOf(body);
  if (code === undefined) {
    if (!ok2xx) throw statusError(res.status);
    throw new ToolError("UPSTREAM", "SafetyKorea 응답에 결과코드(resultCode)가 없습니다", { detail: { reason: "format" } });
  }
  if (code === "2004") return [];
  if (code !== "2000") {
    ctx.log.info("safetykorea error", { service, code });
    throw safetyKoreaError(code);
  }
  if (!ok2xx) throw statusError(res.status);
  return asArray((body as Record<string, unknown>).resultData).filter(isRecord);
}

export async function callSafetyKorea(
  service: SkService,
  conditionValue: string,
  ctx: ToolContext,
  conditionKey: string = SK_SPECS[service].productKey,
): Promise<SkResult> {
  const key = ctx.config.keys.SAFETYKOREA;
  if (!key) throw missingKeyError(["SAFETYKOREA"]);
  const spec = SK_SPECS[service];

  const fetchOnce = async () => {
    const url = new URL(`${SK_BASE_URL}/${spec.path}`);
    url.searchParams.set("conditionKey", conditionKey);
    url.searchParams.set("conditionValue", conditionValue);
    const res = await httpGet(url, ctx, { headers: { AuthKey: key }, allowErrorStatus: true });
    return interpret(res, service, ctx);
  };

  const { value, fromCache } = await cached(
    ctx,
    safetyKoreaCacheKey(service, conditionKey, conditionValue),
    spec.cacheTtlMs,
    fetchOnce,
  );
  ctx.log.debug("safetykorea", { service, fromCache });
  return { items: value, fromCache, capped: value.length >= SK_MAX_ROWS };
}
