import { readFileSync } from "node:fs";
import type { Config } from "../../src/core/config.js";
import type { ToolContext } from "../../src/core/context.js";
import { createTestContext } from "./context.js";
import { okYear, xmlRes } from "./kasi-mock.js";

export const nemcFx = (rel: string): string =>
  readFileSync(new URL(`../fixtures/data-go-kr/${rel}`, import.meta.url), "utf8");

export type Route = (url: URL, init?: RequestInit) => Response | Promise<Response>;

type Kind = "moon" | "peds" | "kasi";

export interface NemcMock {
  fetch: typeof fetch;
  urls: URL[];
  count(kind: Kind): number;
  last(kind: "moon" | "peds"): URL | undefined;
}

export function createNemcMock(
  routes: {
    moon?: Route;
    peds?: Route;
    kasi?: (year: number, init?: RequestInit) => Response | Promise<Response>;
  } = {},
): NemcMock {
  const urls: URL[] = [];
  const calls: { kind: Kind; url: URL }[] = [];
  const fakeFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href);
    urls.push(url);
    if (url.pathname.endsWith("/getBabyListInfoInqire")) {
      calls.push({ kind: "moon", url });
      return routes.moon ? routes.moon(url, init) : xmlRes(nemcFx("nemcMoonlight/seongdong.xml"));
    }
    if (url.pathname.endsWith("/getHsptlMdcncListInfoInqire")) {
      calls.push({ kind: "peds", url });
      return routes.peds ? routes.peds(url, init) : xmlRes(nemcFx("nemcList/ped-code.xml"));
    }
    if (url.pathname.endsWith("/getRestDeInfo")) {
      calls.push({ kind: "kasi", url });
      const year = Number(url.searchParams.get("solYear"));
      return routes.kasi ? routes.kasi(year, init) : okYear(year);
    }
    throw new Error("unexpected url");
  };
  return {
    fetch: fakeFetch as typeof fetch,
    urls,
    count: (kind) => calls.filter((c) => c.kind === kind).length,
    last: (kind) => calls.filter((c) => c.kind === kind).at(-1)?.url,
  };
}

export const TEST_KEY = "Ab+cD/eF=gH+iJ k/L==";
export const KEY_FORMS = [TEST_KEY, encodeURIComponent(TEST_KEY), new URLSearchParams({ x: TEST_KEY }).toString().slice(2)];

export function nemcCtx(
  mock: NemcMock,
  opts?: {
    env?: Record<string, string>;
    clockIso?: string;
    sink?: (line: string) => void;
    config?: Partial<Config>;
  },
): ToolContext {
  const base = createTestContext({
    env: { DATA_GO_KR_SERVICE_KEY: TEST_KEY, ...opts?.env },
    sink: opts?.sink,
  });
  return {
    ...base,
    fetch: mock.fetch,
    clock: { now: () => new Date(opts?.clockIso ?? "2026-10-28T21:30:00+09:00") },
    config: { ...base.config, ...opts?.config },
  };
}

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function nemcXml(items: Record<string, string>[], totalCount = items.length): string {
  const body = items
    .map((it) => `<item>${Object.entries(it).map(([k, v]) => `<${k}>${esc(v)}</${k}>`).join("")}</item>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><response><header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header><body><items>${body}</items><numOfRows>100</numOfRows><pageNo>1</pageNo><totalCount>${totalCount}</totalCount></body></response>`;
}
