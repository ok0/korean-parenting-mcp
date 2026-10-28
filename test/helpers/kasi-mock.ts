import { loadData } from "../../src/data-store/load.js";
import { FIXED_SOLAR_HOLIDAYS, type HolidayEntry } from "../../src/date/holiday-sanity.js";

export interface KasiItem {
  locdate: string;
  isHoliday: "Y" | "N";
  dateName: string;
}

export interface KasiMock {
  fetch: typeof fetch;
  urls: string[];
}

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function kasiXml(items: readonly KasiItem[], opts?: { totalCount?: number; resultCode?: string }): string {
  const body = items
    .map(
      (it) =>
        `<item><dateKind>01</dateKind><dateName>${esc(it.dateName)}</dateName><isHoliday>${it.isHoliday}</isHoliday><locdate>${it.locdate}</locdate><seq>1</seq></item>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><response><header><resultCode>${opts?.resultCode ?? "00"}</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header><body><items>${body}</items><numOfRows>100</numOfRows><pageNo>1</pageNo><totalCount>${opts?.totalCount ?? items.length}</totalCount></body></response>`;
}

export function entriesToItems(entries: readonly HolidayEntry[]): KasiItem[] {
  return entries.map((e) => ({ locdate: e.date.replace(/-/g, ""), isHoliday: "Y", dateName: e.name }));
}

export function xmlRes(text: string, status = 200): Response {
  return new Response(text, { status, headers: { "content-type": "application/xml; charset=utf-8" } });
}

export function htmlRes200(): Response {
  return new Response("<!DOCTYPE html><html><body>오류</body></html>", {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export function emptyRes(): Response {
  return new Response("", { status: 200, headers: { "content-type": "application/xml" } });
}

export function createKasiMock(byYear: Record<number, () => Response | Promise<Response>>): KasiMock {
  const urls: string[] = [];
  const fakeFetch = async (input: string | URL | Request): Promise<Response> => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    urls.push(href);
    const year = Number(new URL(href).searchParams.get("solYear"));
    const route = Number.isInteger(year) ? byYear[year] : undefined;
    if (route) return route();
    return xmlRes(kasiXml([]));
  };
  return { fetch: fakeFetch as typeof fetch, urls };
}

export function createKasiYearMock(route: (year: number, init?: RequestInit) => Response | Promise<Response>): KasiMock {
  const urls: string[] = [];
  const fakeFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    urls.push(href);
    const year = Number(new URL(href).searchParams.get("solYear"));
    return route(year, init);
  };
  return { fetch: fakeFetch as typeof fetch, urls };
}

export function bundledYearEntries(year: number): HolidayEntry[] {
  return loadData("holidays").years[String(year)] ?? [];
}

export function sanityEntries(year: number): HolidayEntry[] {
  return FIXED_SOLAR_HOLIDAYS.map((md) => ({ date: `${year}-${md}`, name: "고정 공휴일" }));
}

export function okYear(year: number): Response {
  return xmlRes(kasiXml(entriesToItems(bundledYearEntries(year).length ? bundledYearEntries(year) : sanityEntries(year))));
}

export function hangUntilAbort(init?: RequestInit): Promise<Response> {
  return new Promise<Response>((_, reject) => {
    const signal = init?.signal;
    if (!signal) {
      setTimeout(() => reject(new DOMException("aborted", "AbortError")), 10_000);
      return;
    }
    if (signal.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
  });
}
