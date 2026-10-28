import type { Config } from "../../src/core/config.js";
import type { ToolContext } from "../../src/core/context.js";
import { BENEFITS_PER_PAGE } from "../../src/clients/data-go-kr-specs.js";
import { createTestContext } from "./context.js";
import { TEST_KEY, nemcFx } from "./nemc-mock.js";
import { xmlRes } from "./kasi-mock.js";

export { KEY_FORMS, TEST_KEY, nemcXml as durXml } from "./nemc-mock.js";
export { xmlRes, hangUntilAbort } from "./kasi-mock.js";

export const dgkFx = (rel: string): string => nemcFx(rel);

export type DgkKind = "benefits" | "dur";
export type BenefitsRoute = (page: number, url: URL, init?: RequestInit) => Response | Promise<Response>;
export type DurRoute = (url: URL, init?: RequestInit) => Response | Promise<Response>;

export interface DgkMock {
  fetch: typeof fetch;
  urls: URL[];
  count(kind: DgkKind): number;
  pages(): number[];
}

export function jsonRes(text: string, status = 200): Response {
  return new Response(text, { status, headers: { "content-type": "application/json; charset=UTF-8" } });
}

export function gatewayXml(code: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>${code}</returnReasonCode><returnAuthMsg>오류</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>`;
}

export function fixtureBenefitRows(): Record<string, unknown>[] {
  const list = JSON.parse(dgkFx("benefitsList/list.json")) as { data: Record<string, unknown>[] };
  const large = JSON.parse(dgkFx("benefitsList/page2-large.json")) as { data: Record<string, unknown>[] };
  return [...list.data, ...large.data];
}

export function benefitRow(over: { 서비스ID: string; 서비스명: string } & Record<string, string>): Record<string, unknown> {
  return {
    서비스목적요약: "",
    서비스분야: "",
    선정기준: "",
    사용자구분: "개인",
    부서명: "",
    소관기관명: "",
    등록일시: "20240101000000",
    상세조회URL: `https://www.gov.kr/portal/rcvfvrSvc/dtlEx/${over.서비스ID}`,
    ...over,
  };
}

export function benefitsJson(rows: readonly Record<string, unknown>[], opts: { page: number; totalCount: number }): string {
  return JSON.stringify({
    currentCount: rows.length,
    data: rows,
    matchCount: opts.totalCount,
    page: opts.page,
    perPage: BENEFITS_PER_PAGE,
    totalCount: opts.totalCount,
  });
}

export function pagedBenefits(
  pages: readonly (readonly Record<string, unknown>[])[],
  totalCount = (pages.length - 1) * BENEFITS_PER_PAGE + (pages.at(-1)?.length ?? 0),
): BenefitsRoute {
  return (page) => jsonRes(benefitsJson(pages[page - 1] ?? [], { page, totalCount }));
}

export function createDgkMock(routes: { benefits?: BenefitsRoute; dur?: DurRoute } = {}): DgkMock {
  const urls: URL[] = [];
  const calls: { kind: DgkKind; url: URL }[] = [];
  const pageList: number[] = [];
  const fakeFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href);
    urls.push(url);
    if (url.pathname.endsWith("/serviceList")) {
      calls.push({ kind: "benefits", url });
      const page = Number(url.searchParams.get("page"));
      pageList.push(page);
      const benefits = routes.benefits ?? pagedBenefits([fixtureBenefitRows()]);
      return benefits(page, url, init);
    }
    if (url.pathname.endsWith("/getPwnmTabooInfoList03")) {
      calls.push({ kind: "dur", url });
      return routes.dur ? routes.dur(url, init) : xmlRes(nemcFx("durPregnancy/single.xml"));
    }
    throw new Error("unexpected url");
  };
  return {
    fetch: fakeFetch as typeof fetch,
    urls,
    count: (kind) => calls.filter((c) => c.kind === kind).length,
    pages: () => [...pageList],
  };
}

export function dgkCtx(
  mock: DgkMock,
  opts?: {
    env?: Record<string, string>;
    sink?: (line: string) => void;
    config?: Partial<Config>;
    now?: () => Date;
  },
): ToolContext {
  const base = createTestContext({
    env: { DATA_GO_KR_SERVICE_KEY: TEST_KEY, ...opts?.env },
    sink: opts?.sink,
  });
  return {
    ...base,
    fetch: mock.fetch,
    clock: { now: opts?.now ?? (() => new Date("2026-10-28T21:30:00+09:00")) },
    config: { ...base.config, ...opts?.config },
  };
}
