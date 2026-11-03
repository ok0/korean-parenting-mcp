import { readFileSync } from "node:fs";
import type { Config } from "../../src/core/config.js";
import type { ToolContext } from "../../src/core/context.js";
import { asArray, isRecord, parseBody, pick } from "../../src/clients/parse.js";
import { createTestContext } from "./context.js";
import { TEST_KEY } from "./nemc-mock.js";
import { hangUntilAbort, xmlRes } from "./kasi-mock.js";

export function lcgvFx(rel: string): string {
  return readFileSync(new URL(`../fixtures/data-go-kr/${rel}`, import.meta.url), "utf8");
}

export function lcgvRes(rel: string, status = 200): Response {
  return xmlRes(lcgvFx(rel), status);
}

export type LcgvErrCode = "12" | "20" | "22" | "23" | "30" | "31" | "40" | "99";

const LCGV_ERRORS: Record<LcgvErrCode, { rel: string; status: number }> = {
  "12": { rel: "lcgvDetail/error-no-service.xml", status: 400 },
  "20": { rel: "lcgvList/error-not-approved.xml", status: 200 },
  "22": { rel: "lcgvList/error-daily-limit.xml", status: 200 },
  "23": { rel: "lcgvList/error-rate-limit.xml", status: 200 },
  "30": { rel: "lcgvList/error-bad-key.xml", status: 403 },
  "31": { rel: "lcgvList/error-key-expired.xml", status: 200 },
  "40": { rel: "lcgvList/empty.xml", status: 200 },
  "99": { rel: "lcgvList/error-unknown-call5.xml", status: 200 },
};

export function lcgvError(code: LcgvErrCode): Response {
  const e = LCGV_ERRORS[code];
  return lcgvRes(e.rel, e.status);
}

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function lcgvListXml(rows: Record<string, string>[], totalCount = rows.length): string {
  const items = rows
    .map((row) => `<servList>${Object.entries(row).map(([k, v]) => `<${k}>${esc(v)}</${k}>`).join("")}</servList>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><wantedList><totalCount>${totalCount}</totalCount><pageNo>1</pageNo><numOfRows>100</numOfRows><resultCode>0</resultCode><resultMessage>SUCCESS</resultMessage>${items}</wantedList>`;
}

export function lcgvDetailXml(fields: Record<string, string | Record<string, string>[]>): string {
  const body = Object.entries(fields)
    .map(([k, v]) => {
      if (typeof v === "string") return `<${k}>${esc(v)}</${k}>`;
      const subs = v.map((entry) => `<${k}>${Object.entries(entry).map(([sk, sv]) => `<${sk}>${esc(sv)}</${sk}>`).join("")}</${k}>`);
      return subs.join("");
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><wantedDtl><resultCode>0</resultCode><resultMessage>SUCCESS</resultMessage>${body}</wantedDtl>`;
}

// 합성: M56 호출 7(경기도·수원시) 형태를 흉내 낸 가짜 행
export const SUWON_SYNTH: Record<string, string>[] = [
  { servId: "SYN0000001", servNm: "합성 항목 1", ctpvNm: "경기도", sggNm: "수원시", lastModYmd: "20261001" },
  { servId: "SYN0000002", servNm: "합성 항목 2", ctpvNm: "경기도", sggNm: "수원시", lastModYmd: "20260901" },
];

export function defaultListRoute(url: URL): Response {
  const c = url.searchParams.get("ctpvNm") ?? "";
  const s = url.searchParams.get("sggNm") ?? "";
  const l = url.searchParams.get("lifeArray") ?? "";
  const w = url.searchParams.get("searchWrd") ?? "";
  if (w === "출산") return lcgvRes("lcgvList/search-chulsan.xml");
  if (c === "서울특별시" && s === "마포구") {
    if (l === "") return lcgvRes("lcgvList/mapo.xml");
    if (l === "007") return lcgvRes("lcgvList/mapo-life007.xml");
    // M56 호출 4 원본 응답과 바이트 단위로 동일
    if (l === "007,001") return lcgvRes("lcgvList/mapo-life007.xml");
    // M56 호출 3 원본 응답과 바이트 단위로 동일
    if (l === "001") return lcgvRes("lcgvList/empty.xml");
  }
  if (c === "서울특별시" && s === "" && l === "007") return lcgvRes("lcgvList/seoul-life007.xml");
  // lifeArray는 무시됨: 이 샘플은 lifeArray 없이 받은 응답
  if (c === "전남광주통합특별시" && s === "해남군") return lcgvRes("lcgvList/haenam.xml");
  if (c === "전라남도" && s === "해남군") return lcgvRes("lcgvList/empty.xml");
  // 합성
  if (c === "경기도" && s === "수원시") return xmlRes(lcgvListXml(SUWON_SYNTH));
  // M56 호출 8 원본 응답과 바이트 단위로 동일
  if (c === "경기도" && s === "수원시 장안구") return lcgvRes("lcgvList/empty.xml");
  throw new Error("unexpected lcgv list request");
}

export function defaultDetailRoute(url: URL): Response {
  const id = url.searchParams.get("servId") ?? "";
  if (id === "WLF00003366") return lcgvRes("lcgvDetail/amount.xml");
  if (id === "WLF00004358") return lcgvRes("lcgvDetail/mapo-life007.xml");
  // 합성
  return xmlRes(lcgvDetailXml({ servId: id, servNm: `합성 상세 ${id}`, sprtTrgtCn: "합성 지원 대상", lastModYmd: "20261001" }));
}

export type LcgvRoute = (url: URL, init?: RequestInit, n?: number) => Response | Promise<Response>;

export function sequence(...steps: LcgvRoute[]): LcgvRoute {
  return (url, init, n = 0) => steps[Math.min(n, steps.length - 1)]!(url, init, n);
}

export const hang: LcgvRoute = (_u, init) => hangUntilAbort(init);

export interface LcgvMock {
  fetch: typeof fetch;
  urls: URL[];
  count(kind?: "list" | "detail"): number;
  lists(): URL[];
  details(): URL[];
}

export function createLcgvMock(routes: { list?: LcgvRoute; detail?: LcgvRoute } = {}): LcgvMock {
  const urls: URL[] = [];
  const listUrls: URL[] = [];
  const detailUrls: URL[] = [];
  const fakeFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href);
    urls.push(url);
    if (url.pathname.endsWith("/LcgvWelfarelist")) {
      const n = listUrls.length;
      listUrls.push(url);
      return (routes.list ?? defaultListRoute)(url, init, n);
    }
    if (url.pathname.endsWith("/LcgvWelfaredetailed")) {
      const n = detailUrls.length;
      detailUrls.push(url);
      return (routes.detail ?? defaultDetailRoute)(url, init, n);
    }
    throw new Error("unexpected url");
  };
  return {
    fetch: fakeFetch as typeof fetch,
    urls,
    count: (kind) => (kind === "list" ? listUrls.length : kind === "detail" ? detailUrls.length : urls.length),
    lists: () => [...listUrls],
    details: () => [...detailUrls],
  };
}

export type LcgvCtx = ToolContext & { advance(ms: number): void };

export function lcgvCtx(
  mock: LcgvMock,
  opts?: {
    nowIso?: string;
    config?: Partial<Config>;
    sink?: (line: string) => void;
    noKey?: boolean;
  },
): LcgvCtx {
  const base = createTestContext({
    env: opts?.noKey ? {} : { DATA_GO_KR_SERVICE_KEY: TEST_KEY },
    sink: opts?.sink,
  });
  const startMs = Date.parse(opts?.nowIso ?? "2026-11-03T12:00:00+09:00");
  let offset = 0;
  return {
    ...base,
    fetch: mock.fetch,
    clock: { now: () => new Date(startMs + offset) },
    config: { ...base.config, ...opts?.config },
    advance(ms: number): void {
      offset += ms;
    },
  };
}

export function lcgvItems(rel: string): Record<string, unknown>[] {
  return asArray(pick(parseBody(lcgvFx(rel), "application/xml"), ["wantedList", "servList"])).filter(isRecord);
}

export function lcgvDetailItem(rel: string): Record<string, unknown> {
  const v = pick(parseBody(lcgvFx(rel), "application/xml"), ["wantedDtl"]);
  if (!isRecord(v)) throw new Error(`wantedDtl not found: ${rel}`);
  return v;
}

// 금액 표기(예: 100,000원, 2백만원, 1백5십만원). M61에서도 재사용
export const AMOUNT_TOKEN = /\d[\d,.십백천만억]*\s*원/gu;

// 비율 표기(예: 1/2, 2분의 1)
export const RATIO_TOKEN = /\d+\s*분의\s*\d+/gu;
