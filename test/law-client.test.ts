import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createLawClient, lawLink, normName, parseAnnexNo, toJo } from "../src/clients/law.js";
import { ToolError, formatToolError } from "../src/core/errors.js";
import { createTestContext } from "./helpers/context.js";

const FAKE = "ab+c/d=e1";

const BODY: Record<string, string> = {
  admrul: readFileSync(new URL("./fixtures/law/admrul/checkup.json", import.meta.url), "utf8"),
  law: readFileSync(new URL("./fixtures/law/law/labor-standards-act.json", import.meta.url), "utf8"),
  licbyl: readFileSync(new URL("./fixtures/law/licbyl/mch-rule-p2.json", import.meta.url), "utf8"),
  lawjosub: readFileSync(new URL("./fixtures/law/lawjosub/labor-074.json", import.meta.url), "utf8"),
};

function jsonRes(body: string): Response {
  return new Response(body, { headers: { "content-type": "application/json" } });
}

function mockFetch(handler: (url: string) => Response) {
  const urls: string[] = [];
  const fn = (async (input: string | URL | Request) => {
    const u = String(input);
    urls.push(u);
    return handler(u);
  }) as unknown as typeof fetch;
  return { fetch: fn, urls };
}

function fixtureMock() {
  return mockFetch((u) => {
    const target = new URL(u).searchParams.get("target") ?? "";
    return jsonRes(BODY[target] ?? "{}");
  });
}

async function catchTool(p: Promise<unknown>): Promise<ToolError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ToolError) return e;
    throw e;
  }
  throw new Error("expected rejection");
}

describe("law client", () => {
  it("toJo converts and rejects", () => {
    expect(toJo(74)).toBe("007400");
    expect(toJo(10, 2)).toBe("001002");
    expect(toJo(3)).toBe("000300");
    expect(() => toJo(0)).toThrow();
    expect(() => toJo(10000)).toThrow();
    expect(() => toJo(1.5)).toThrow();
    expect(() => toJo(3, 100)).toThrow();
  });

  it("normName unifies middle-dot variants", () => {
    const a = normName("일·가정");
    const b = normName("일ㆍ가정");
    const c = normName("일・가정");
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("OC is encoded exactly once and type=JSON", async () => {
    const mock = fixtureMock();
    const ctx = { ...createTestContext({ env: { LAW_OC: FAKE } }), fetch: mock.fetch };
    const client = createLawClient(ctx);
    await client.searchAdmrul("건강검진 실시기준");
    await client.searchLicbyl("모자보건법 시행규칙");
    await client.searchLaw("근로기준법");
    await client.getArticle("TEST-LAW-1", toJo(74));
    expect(mock.urls).toHaveLength(4);
    for (const u of mock.urls) {
      const parsed = new URL(u);
      expect(parsed.hostname).toBe("www.law.go.kr");
      expect(parsed.protocol).toBe("https:");
      expect(parsed.searchParams.get("OC")).toBe(FAKE);
      expect(parsed.searchParams.get("type")).toBe("JSON");
      expect(u.split(encodeURIComponent(FAKE)).length - 1).toBe(1);
      expect(u).not.toContain("%25");
    }
    const joUrl = mock.urls.find((u) => new URL(u).searchParams.get("target") === "lawjosub");
    expect(joUrl).toBeDefined();
    expect(new URL(joUrl!).searchParams.get("JO")).toBe("007400");
  });

  it("parses rows from fixtures", async () => {
    const mock = fixtureMock();
    const ctx = { ...createTestContext({ env: { LAW_OC: FAKE } }), fetch: mock.fetch };
    const client = createLawClient(ctx);
    const admrul = await client.searchAdmrul("건강검진 실시기준");
    expect(admrul[0]?.serial).toBe("2100000272270");
    expect(admrul[0]?.ruleId).toBe("38208");
    expect(admrul[0]?.number).toBe("2026-6");
    expect(admrul[0]?.issued).toBe("20260107");
    expect(admrul[0]?.link?.startsWith("https://www.law.go.kr/DRF/lawService.do?")).toBe(true);
    expect(admrul[0]?.link).not.toContain("OC=");
    const laws = await client.searchLaw("근로기준법");
    expect(laws).toHaveLength(3);
    expect(laws[0]?.lawId).toBe("001872");
    expect(laws[0]?.mst).toBe("285279");
    expect(laws[0]?.effective).toBe("20261008");
    const licbyl = await client.searchLicbyl("모자보건법 시행규칙");
    const annex1 = licbyl.filter((r) => {
      const a = parseAnnexNo(r.annexNo);
      return a?.no === 1 && a.branch === 0;
    });
    expect(annex1).toHaveLength(2);
    const bylRow = annex1.find((r) => r.kind === "별표");
    expect(bylRow?.promulgated).toBe("20260304");
    expect(bylRow?.promulgationNo).toBe("01159");
    expect(bylRow?.pdfLink?.startsWith("https://www.law.go.kr/LSW/flDownload.do?")).toBe(true);
    const article = await client.getArticle("001872", toJo(74));
    expect(article.title).toBe("임산부의 보호");
    expect(article.articleNo).toBe("74");
    expect(article.branch).toBeUndefined();
    expect(article.articleEffective).toBe("20261008");
    expect(article.lines.some((l) => l.includes("출산전후휴가"))).toBe(true);
  });

  it("parses 조문가지번호 and skips 전문 units", async () => {
    const fixture = (name: string) => readFileSync(new URL(`./fixtures/law/lawjosub/${name}`, import.meta.url), "utf8");
    const byJo: Record<string, string> = { "001802": fixture("equal-1802.json"), "001900": fixture("equal-1900.json") };
    const mock = mockFetch((u) => jsonRes(byJo[new URL(u).searchParams.get("JO") ?? ""] ?? "{}"));
    const ctx = { ...createTestContext({ env: { LAW_OC: FAKE } }), fetch: mock.fetch };
    const client = createLawClient(ctx);
    const sub = await client.getArticle("000130", toJo(18, 2));
    expect(sub.articleNo).toBe("18");
    expect(sub.branch).toBe("2");
    expect(sub.title).toBe("배우자 출산전후휴가");
    const main = await client.getArticle("000130", toJo(19));
    expect(main.articleNo).toBe("19");
    expect(main.title).toBe("육아휴직");

    const synthetic = {
      법령: {
        조문: {
          조문단위: [
            { 조문여부: "전문", 조문번호: "19", 조문내용: "제3절 육아휴직" },
            { 조문여부: "조문", 조문번호: "19", 조문제목: "육아휴직", 조문내용: "제19조(육아휴직)" },
          ],
        },
      },
    };
    const synthMock = mockFetch(() => jsonRes(JSON.stringify(synthetic)));
    const synthClient = createLawClient({ ...createTestContext({ env: { LAW_OC: FAKE } }), fetch: synthMock.fetch });
    const skipped = await synthClient.getArticle("000199", toJo(19));
    expect(skipped.lines).toEqual(["제19조(육아휴직)"]);
    expect(skipped.title).toBe("육아휴직");
  });

  it("parseAnnexNo reads 6-digit NNNNBB and plain numbers", () => {
    expect(parseAnnexNo("000100")).toEqual({ no: 1, branch: 0 });
    expect(parseAnnexNo("000905")).toEqual({ no: 9, branch: 5 });
    expect(parseAnnexNo("0001")).toEqual({ no: 1, branch: 0 });
    expect(parseAnnexNo("1")).toEqual({ no: 1, branch: 0 });
    expect(parseAnnexNo("")).toBeUndefined();
    expect(parseAnnexNo(undefined)).toBeUndefined();
  });

  it("bad OC JSON (HTTP 200) is NOT_APPROVED", async () => {
    const badOc = readFileSync(new URL("./fixtures/law/law/error-bad-oc.json", import.meta.url), "utf8");
    const mock = mockFetch(() => new Response(badOc, { status: 200, headers: { "content-type": "application/json;charset=UTF-8" } }));
    const ctx = { ...createTestContext({ env: { LAW_OC: FAKE } }), fetch: mock.fetch };
    const client = createLawClient(ctx);
    const err = await catchTool(client.searchLaw("근로기준법"));
    expect(err.kind).toBe("NOT_APPROVED");
  });

  it("single object item is accepted", async () => {
    const bodies: Record<string, string> = {
      one: JSON.stringify({ LawSearch: { totalCnt: "1", law: { 법령명한글: "x" } } }),
      zero: JSON.stringify({ LawSearch: { totalCnt: "0" } }),
      bad: JSON.stringify({ foo: 1 }),
    };
    let current = "one";
    const mock = mockFetch(() => jsonRes(bodies[current] ?? "{}"));
    const ctx = { ...createTestContext({ env: { LAW_OC: FAKE } }), fetch: mock.fetch };
    const client = createLawClient(ctx);
    expect(await client.searchLaw("x-one")).toHaveLength(1);
    current = "zero";
    expect(await client.searchLaw("x-zero")).toEqual([]);
    current = "bad";
    const err = await catchTool(client.searchLaw("x-bad"));
    expect(err.kind).toBe("UPSTREAM");
    expect(err.detail?.reason).toBe("format");
  });

  it("guards: empty, HTML, verification failure are distinct", async () => {
    let current = { status: 200, body: "", type: "application/json" };
    const mock = mockFetch(() => new Response(current.body, { status: current.status, headers: { "content-type": current.type } }));
    const ctx = { ...createTestContext({ env: { LAW_OC: FAKE } }), fetch: mock.fetch };
    const client = createLawClient(ctx);

    const empty = await catchTool(client.searchLaw("x"));
    expect(empty.kind).toBe("UPSTREAM");
    expect(empty.message).toContain("비어");

    current = { status: 200, body: "<!DOCTYPE html><html><body>오류</body></html>", type: "text/html" };
    const html = await catchTool(client.searchLaw("x"));
    expect(html.kind).toBe("UPSTREAM");
    expect(html.message).toContain("HTML");

    current = { status: 200, body: "<html>사용자 정보 검증에 실패하였습니다</html>", type: "text/html" };
    const denied = await catchTool(client.searchLaw("x"));
    expect(denied.kind).toBe("NOT_APPROVED");
    const deniedActions = denied.actions.join("\n");
    expect(deniedActions).toContain("IP");
    expect(deniedActions).toContain("도메인");
    expect(deniedActions).toContain("LAW_OC");

    const texts = [empty, html, denied].map((e) => formatToolError(e, "get_leave_article", ctx).content[0]?.text);
    expect(new Set(texts).size).toBe(3);
  });

  it("lawLink strips OC and rejects foreign hosts", () => {
    const link = lawLink("/DRF/x.do?OC=test&ID=1");
    expect(link).toBeDefined();
    expect(link).not.toContain("OC");
    expect(link).toContain("ID=1");
    expect(lawLink("https://evil.example/x")).toBeUndefined();
    expect(lawLink("https://xlaw.go.kr/x")).toBeUndefined();
    expect(lawLink("https://evil-law.go.kr/x")).toBeUndefined();
    expect(lawLink("https://www.law.go.kr/DRF/x.do?ID=1")?.startsWith("https://www.law.go.kr/")).toBe(true);
  });

  it("missing OC throws MISSING_KEY", async () => {
    const mock = fixtureMock();
    const ctx = { ...createTestContext({}), fetch: mock.fetch };
    const client = createLawClient(ctx);
    const err = await catchTool(client.searchLaw("근로기준법"));
    expect(err.kind).toBe("MISSING_KEY");
    expect(mock.urls).toHaveLength(0);
  });
});
