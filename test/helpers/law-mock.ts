import { loadData } from "../../src/data-store/load.js";

export interface LawMock {
  fetch: typeof fetch;
  urls: string[];
}

export type LawRoute = (url: URL) => Response | Promise<Response> | undefined;

export function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export function htmlRes(html = "<!DOCTYPE html><html><body>오류</body></html>"): Response {
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function digits(v: string | undefined): string | undefined {
  return v === undefined ? undefined : v.replace(/\D/g, "");
}

export function sameAsStored(oc?: string): LawRoute {
  const docs = loadData("basis-documents").documents;
  return (url) => {
    const target = url.searchParams.get("target");
    const query = url.searchParams.get("query");
    if (target === "law") {
      const doc = docs.find((d) => d.law_api?.kind === "law" && d.law_api.law_name === query);
      if (!doc || doc.law_api?.kind !== "law") return jsonRes({ LawSearch: { totalCnt: "0" } });
      const key = doc.law_api;
      const row: Record<string, string> = {
        법령명한글: key.law_name,
        법령ID: `TEST-${key.mst ?? "NONE"}`,
        법령상세링크: `/DRF/lawService.do?OC=${encodeURIComponent(oc ?? "test")}&target=law&MST=${key.mst ?? ""}&type=HTML`,
      };
      if (key.mst !== undefined) row.법령일련번호 = key.mst;
      const effective = digits(key.effective);
      if (effective !== undefined) row.시행일자 = effective;
      return jsonRes({ LawSearch: { totalCnt: "1", law: [row] } });
    }
    if (target === "admrul") {
      const doc = docs.find((d) => d.law_api?.kind === "admrul" && d.law_api.name === query);
      if (!doc || doc.law_api?.kind !== "admrul") return jsonRes({ AdmRulSearch: { totalCnt: "0" } });
      const key = doc.law_api;
      const row: Record<string, string> = {
        행정규칙명: key.name,
        행정규칙ID: "TEST-ADM-1",
        상세링크: `/DRF/lawService.do?OC=${encodeURIComponent(oc ?? "test")}&target=admrul&ID=1`,
      };
      if (key.number !== undefined) row.발령번호 = key.number;
      const issued = digits(key.issued);
      if (issued !== undefined) row.발령일자 = issued;
      return jsonRes({ AdmRulSearch: { totalCnt: "1", admrul: [row] } });
    }
    if (target === "licbyl") {
      return jsonRes({ LicBylSearch: { totalCnt: "0" } });
    }
    return undefined;
  };
}

export function createLawMock(...routes: LawRoute[]): LawMock {
  const urls: string[] = [];
  const fakeFetch = async (input: string | URL | Request): Promise<Response> => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    urls.push(href);
    const url = new URL(href);
    for (const route of routes) {
      const res = await route(url);
      if (res !== undefined) return res;
    }
    return jsonRes({ LawSearch: { totalCnt: "0" } });
  };
  return { fetch: fakeFetch as typeof fetch, urls };
}
