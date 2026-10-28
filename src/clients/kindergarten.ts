import { CACHE_TTL_MS } from "../core/cache-ttl.js";
import { cached } from "../core/cache.js";
import type { ToolContext } from "../core/context.js";
import { KINDERGARTEN_KEY_ACTIONS, missingKeyError, ToolError } from "../core/errors.js";
import { httpGet } from "../core/http.js";
import { asArray, isRecord, parseBody } from "./parse.js";

export const KG_BASE_URL = "https://e-childschoolinfo.moe.go.kr/api/notice/basicInfo2.do";
export const KG_SITE_URL = "https://e-childschoolinfo.moe.go.kr";
export const KG_SUSPECT_ROWS = 100;

export interface KgQuery {
  sidoCode: string;
  sggCode: string;
}

export interface KgResult {
  items: Record<string, unknown>[];
  fromCache: boolean;
  suspectCapped: boolean;
}

export function kindergartenCacheKey(q: KgQuery): string {
  return `kg:basicInfo2?${new URLSearchParams([["sidoCode", q.sidoCode], ["sggCode", q.sggCode]]).toString()}`;
}

const KG_RETRY = ["잠시 후 다시 시도하세요. 계속되면 유치원알리미 사이트(https://e-childschoolinfo.moe.go.kr)에서 직접 확인하세요."];

function upstream(message: string, reason: string): ToolError {
  return new ToolError("UPSTREAM", message, { actions: KG_RETRY, detail: { reason } });
}

function statusError(status: number): ToolError {
  if (status === 401 || status === 403) {
    return new ToolError("KEY_INVALID", `유치원알리미 인증 실패(HTTP ${status})`, { actions: KINDERGARTEN_KEY_ACTIONS });
  }
  if (status === 429) return new ToolError("RATE_LIMIT", "외부 서버 호출 한도 초과(HTTP 429)");
  return upstream(`유치원알리미 서버 오류(HTTP ${status})`, "http");
}

function clipMsg(v: unknown): string {
  if (typeof v === "string" && v.trim() !== "") return v.trim().slice(0, 60);
  return "사유 미기재";
}

function interpret(res: { status: number; contentType: string; text: string }, ctx: ToolContext): Record<string, unknown>[] {
  const ok2xx = res.status >= 200 && res.status < 300;
  const t = res.text.replace(/^﻿/, "").trim();
  let body: unknown;
  try {
    body = parseBody(res.text, res.contentType, { jsonDespiteHtmlType: true });
  } catch (err) {
    if (!ok2xx) throw statusError(res.status);
    const reason = err instanceof ToolError ? err.detail?.reason : undefined;
    if (reason === "html") throw upstream("유치원알리미 오류: 데이터 대신 웹 페이지(HTML)를 받았습니다", "html");
    if (reason === "empty") throw upstream("유치원알리미 오류: 빈 응답을 받았습니다", "empty");
    if (t.startsWith("{") || t.startsWith("[")) throw upstream("유치원알리미 오류: 응답(JSON)을 해석하지 못했습니다", "format");
    throw upstream("유치원알리미 오류: 응답이 JSON 형식이 아닙니다", "not-json");
  }

  if (!t.startsWith("{") || !isRecord(body)) {
    if (!ok2xx) throw statusError(res.status);
    throw upstream("유치원알리미 오류: 응답이 JSON 형식이 아닙니다", "not-json");
  }

  const status = typeof body.status === "string" ? body.status.trim().toUpperCase() : "";
  const logged = ["SUCCESS", "DENIED", "ERROR"].includes(status) ? status : "other";

  if (status === "DENIED") {
    ctx.log.info("kindergarten error", { status: logged });
    throw new ToolError("KEY_INVALID", `유치원알리미 인증 실패(DENIED: ${clipMsg(body.message)})`, {
      actions: KINDERGARTEN_KEY_ACTIONS,
      detail: { code: "DENIED" },
    });
  }
  if (status === "ERROR") {
    ctx.log.info("kindergarten error", { status: logged });
    throw upstream(`유치원알리미 오류(ERROR: ${clipMsg(body.message)})`, "error");
  }
  if (status === "") {
    if (!ok2xx) throw statusError(res.status);
    throw upstream("유치원알리미 오류: 응답에 처리 상태(status)가 없습니다", "format");
  }
  if (status !== "SUCCESS") {
    ctx.log.info("kindergarten error", { status: logged });
    throw upstream(`유치원알리미 오류(상태 ${status.slice(0, 20)})`, "status");
  }
  if (!ok2xx) throw statusError(res.status);
  if (!("kinderInfo" in body)) throw upstream("유치원알리미 오류: 응답에 유치원 목록(kinderInfo)이 없습니다", "no-list");
  return asArray(body.kinderInfo).filter(isRecord);
}

export async function callKindergartenBasic(q: KgQuery, ctx: ToolContext): Promise<KgResult> {
  const key = ctx.config.keys.KINDERGARTEN;
  if (!key) throw missingKeyError(["KINDERGARTEN"]);

  const fetchOnce = async (): Promise<Record<string, unknown>[]> => {
    const url = new URL(KG_BASE_URL);
    url.searchParams.set("key", key);
    url.searchParams.set("sidoCode", q.sidoCode);
    url.searchParams.set("sggCode", q.sggCode);
    const res = await httpGet(url, ctx, { allowErrorStatus: true });
    return interpret(res, ctx);
  };

  const { value, fromCache } = await cached(ctx, kindergartenCacheKey(q), CACHE_TTL_MS.kindergarten, fetchOnce);
  ctx.log.debug("kindergarten", { fromCache, count: value.length });
  return { items: value, fromCache, suspectCapped: value.length >= KG_SUSPECT_ROWS };
}
