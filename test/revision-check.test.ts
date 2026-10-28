import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ToolContext } from "../src/core/context.js";
import { checkRevisionDocs, checkRevisions, type RevisionStatus } from "../src/provenance/revision-check.js";
import type { BasisDoc } from "../src/data-store/schema.js";
import { createTestContext } from "./helpers/context.js";
import { createLawMock, htmlRes, jsonRes, type LawRoute } from "./helpers/law-mock.js";

const FAKE = "ab+c/d=e1";

const LAW_DOC = {
  id: "test-law",
  title: "테스트법",
  doc_no: "법률 제1호",
  kind: "law",
  url: "https://www.law.go.kr/test-law",
  as_of: "2026-01-01",
  effective: "2026-01-01",
  law_api: { kind: "law", law_name: "테스트법", mst: "100", effective: "2026-01-01" },
} as BasisDoc;

const ADM_DOC = {
  id: "test-adm",
  title: "테스트 고시",
  doc_no: "제2026-1호",
  kind: "admrul",
  url: "https://www.law.go.kr/test-adm",
  as_of: "2026-01-01",
  promulgated: "2026-01-01",
  law_api: { kind: "admrul", rule_id: null, name: "테스트 고시", serial: "1", number: "제2026-1호", issued: "2026-01-01" },
} as BasisDoc;

const BYL_DOC = {
  id: "test-byl",
  title: "테스트법 시행규칙 별표 1",
  doc_no: "별표 1",
  kind: "licbyl",
  url: "https://www.law.go.kr/test-byl",
  as_of: "2026-01-01",
  promulgated: "2026-01-01",
  law_api: { kind: "licbyl", law_name: "테스트법 시행규칙", annex_no: "1", promulgation_no: "1" },
} as BasisDoc;

const NOBASE_DOC = {
  id: "test-nobase",
  title: "기준없음법",
  doc_no: "법률 제2호",
  kind: "law",
  url: "https://www.law.go.kr/test-nobase",
  as_of: "2026-01-01",
  effective: "2026-01-01",
  law_api: { kind: "law", law_name: "기준없음법" },
} as BasisDoc;

const WEB_DOC = {
  id: "test-web",
  title: "테스트 안내 페이지",
  doc_no: "안내 1",
  kind: "web",
  url: "https://example.test/guide",
  as_of: "2026-01-01",
  promulgated: "2026-01-01",
  law_api: null,
} as BasisDoc;

const ADM2_DOC = {
  ...ADM_DOC,
  id: "test-adm-2",
  law_api: { kind: "admrul", rule_id: "TEST-ADM-2", name: "테스트 고시", serial: "2", number: "제2026-2호" },
} as BasisDoc;

function serve(target: string, body: unknown): LawRoute {
  return (url) => (url.searchParams.get("target") === target ? jsonRes(body) : undefined);
}

function lawBody(mst = "100", effective = "20260101", link = "/DRF/lawService.do?OC=test&target=law&MST=100&type=HTML") {
  return {
    LawSearch: {
      totalCnt: "1",
      law: [{ 법령명한글: "테스트법", 법령일련번호: mst, 법령ID: "TEST-LAW-1", 시행일자: effective, 법령상세링크: link }],
    },
  };
}

function admBody(number = "제2026-1호", serial = "1") {
  return {
    AdmRulSearch: {
      totalCnt: "1",
      admrul: [
        {
          행정규칙명: "테스트 고시",
          행정규칙일련번호: serial,
          행정규칙ID: "TEST-ADM-1",
          발령번호: number,
          발령일자: "20260101",
          행정규칙상세링크: "/DRF/lawService.do?OC=test&target=admrul&ID=1&type=HTML",
        },
      ],
    },
  };
}

function bylBody(no = "1", annex = "0001") {
  return {
    LicBylSearch: {
      totalCnt: "1",
      licbyl: [
        {
          별표번호: annex,
          별표명: "(테스트) 별표 1",
          관련법령명: "테스트법 시행규칙",
          공포번호: no,
          별표법령상세링크: "/LSW/lsBylInfoP.do?OC=test&bylSeq=1",
        },
      ],
    },
  };
}

function ctxWith(mock: { fetch: typeof fetch }, env: Record<string, string> = { LAW_OC: FAKE }, sink?: (line: string) => void): ToolContext {
  return { ...createTestContext({ env, sink }), fetch: mock.fetch };
}

function byId(list: RevisionStatus[], id: string): RevisionStatus {
  const found = list.find((s) => s.basisId === id);
  if (!found) throw new Error(`status not found: ${id}`);
  return found;
}

describe("revision check", () => {
  it("no OC: all skipped, fetch never called", async () => {
    const mock = createLawMock();
    const out = await checkRevisionDocs([LAW_DOC, ADM_DOC, BYL_DOC, NOBASE_DOC, WEB_DOC], ctxWith(mock, {}));
    expect(byId(out, "test-web").message).toBe("자동 확인 대상 아님");
    for (const id of ["test-law", "test-adm", "test-byl", "test-nobase"]) {
      expect(byId(out, id).state).toBe("skipped");
      expect(byId(out, id).message).toBe("법제처 OC 미설정: 개정 여부 확인 생략");
    }
    expect(mock.urls).toHaveLength(0);
  });

  it("same values are confirmed", async () => {
    const mock = createLawMock(serve("law", lawBody()), serve("admrul", admBody()), serve("licbyl", bylBody()));
    const out = await checkRevisionDocs([LAW_DOC, ADM_DOC, BYL_DOC], ctxWith(mock));
    for (const s of out) {
      expect(s.state).toBe("confirmed");
      expect(s.message).toBe("원문 확인됨");
    }
  });

  it("changed per kind with stored/current and link", async () => {
    const law = await checkRevisionDocs(
      [LAW_DOC],
      ctxWith(createLawMock(serve("law", lawBody("101", "20260101", "/DRF/lawService.do?OC=test&target=law&MST=101&type=HTML")))),
    );
    const adm = await checkRevisionDocs([ADM_DOC], ctxWith(createLawMock(serve("admrul", admBody("제2026-2호")))));
    const byl = await checkRevisionDocs([BYL_DOC], ctxWith(createLawMock(serve("licbyl", bylBody("2")))));

    const lawStatus = law[0]!;
    expect(lawStatus.state).toBe("changed");
    expect(lawStatus.message).toContain("근거가 개정되었습니다. 원문을 확인하세요");
    expect(lawStatus.message).toContain("저장");
    expect(lawStatus.message).toContain("현재");
    expect(lawStatus.message).toContain("100");
    expect(lawStatus.message).toContain("101");
    expect(lawStatus.link?.startsWith("https://www.law.go.kr/")).toBe(true);
    expect(lawStatus.link).not.toContain("OC");

    const admStatus = adm[0]!;
    expect(admStatus.state).toBe("changed");
    expect(admStatus.message).toContain("제2026-1호");
    expect(admStatus.message).toContain("제2026-2호");

    const bylStatus = byl[0]!;
    expect(bylStatus.state).toBe("changed");
    expect(bylStatus.message).toContain("공포번호 1");
    expect(bylStatus.message).toContain("공포번호 2");
  });

  it("admrul serial-only difference is changed", async () => {
    const out = await checkRevisionDocs([ADM_DOC], ctxWith(createLawMock(serve("admrul", admBody("제2026-1호", "2")))));
    expect(out[0]!.state).toBe("changed");
  });

  it("no baseline and not found are distinct", async () => {
    const none = createLawMock();
    const noBase = await checkRevisionDocs([NOBASE_DOC], ctxWith(none));
    expect(noBase[0]!.message).toBe("개정 여부 확인 불가(비교 기준 미등록)");
    expect(none.urls).toHaveLength(0);

    const notFound = await checkRevisionDocs([LAW_DOC], ctxWith(createLawMock()));
    expect(notFound[0]!.message).toBe("개정 여부 확인 불가(조회 결과에 대상 없음)");
    expect(noBase[0]!.message).not.toBe(notFound[0]!.message);
  });

  it("ambiguous admrul name without rule_id, rule_id picks the row", async () => {
    const twoRows = {
      AdmRulSearch: {
        totalCnt: "2",
        admrul: [
          { 행정규칙명: "테스트 고시", 행정규칙일련번호: "1", 행정규칙ID: "TEST-ADM-1", 발령번호: "제2026-1호" },
          { 행정규칙명: "테스트 고시", 행정규칙일련번호: "2", 행정규칙ID: "TEST-ADM-2", 발령번호: "제2026-2호" },
        ],
      },
    };
    const ambiguous = await checkRevisionDocs([ADM_DOC], ctxWith(createLawMock(serve("admrul", twoRows))));
    expect(ambiguous[0]!.state).toBe("unavailable");
    expect(ambiguous[0]!.reason).toBe("ambiguous");

    const byRuleId = await checkRevisionDocs([ADM2_DOC], ctxWith(createLawMock(serve("admrul", twoRows))));
    expect(byRuleId[0]!.state).toBe("confirmed");
  });

  it("failures map to unavailable without rejecting", async () => {
    const cases: { name: string; route: LawRoute }[] = [
      { name: "http 500", route: () => jsonRes({ error: true }, 500) },
      { name: "network reject", route: () => Promise.reject(new TypeError("boom")) },
      { name: "html", route: () => htmlRes() },
      { name: "empty body", route: () => new Response("", { status: 200, headers: { "content-type": "application/json" } }) },
      { name: "unrecognized shape", route: () => jsonRes({ foo: 1 }) },
    ];
    for (const c of cases) {
      const out = await checkRevisionDocs([LAW_DOC], ctxWith(createLawMock(c.route)));
      expect(out[0]!.state, c.name).toBe("unavailable");
      expect(out[0]!.message.startsWith("개정 여부 확인 불가"), c.name).toBe(true);
    }
  });

  it("deadline marks pending docs unavailable", async () => {
    const pendingLaw: LawRoute = (url) => (url.searchParams.get("target") === "law" ? new Promise<Response>(() => {}) : undefined);
    const mock = createLawMock(pendingLaw, serve("admrul", admBody()));
    const started = Date.now();
    const out = await checkRevisionDocs([LAW_DOC, ADM_DOC], ctxWith(mock), { deadlineMs: 100 });
    const elapsed = Date.now() - started;
    expect(byId(out, "test-adm").state).toBe("confirmed");
    expect(byId(out, "test-law").state).toBe("unavailable");
    expect(byId(out, "test-law").reason).toBe("deadline");
    expect(elapsed).toBeLessThan(600);
  });

  it("partial failure keeps other results", async () => {
    const lawFails: LawRoute = (url) => (url.searchParams.get("target") === "law" ? jsonRes({}, 500) : undefined);
    const out = await checkRevisionDocs([LAW_DOC, ADM_DOC], ctxWith(createLawMock(lawFails, serve("admrul", admBody()))));
    expect(byId(out, "test-adm").state).toBe("confirmed");
    expect(byId(out, "test-law").state).toBe("unavailable");
  });

  it("checkRevisions never throws on unknown id", async () => {
    const out = await checkRevisions(["no-such-doc"], ctxWith(createLawMock()));
    expect(out).toHaveLength(1);
    expect(out[0]!.state).toBe("unavailable");
  });

  it("logs and statuses carry no OC", async () => {
    const lines: string[] = [];
    const encoded = encodeURIComponent(FAKE);
    const link = `/DRF/lawService.do?OC=${encoded}&target=law&MST=101&type=HTML`;
    const mock = createLawMock(serve("law", lawBody("101", "20260101", link)));
    const out = await checkRevisionDocs([LAW_DOC], ctxWith(mock, { LAW_OC: FAKE }, (l) => lines.push(l)));
    const blob = JSON.stringify(out) + lines.join("");
    expect(out[0]!.state).toBe("changed");
    expect(blob).not.toContain(FAKE);
    expect(blob).not.toContain(encoded);
  });

  it("live-format licbyl rows: 6-digit annex number and kind filter", async () => {
    const rows = (no2: string) => ({
      licBylSearch: {
        totalCnt: "2",
        licbyl: [
          { 별표번호: "000100", 별표종류: "서식", 관련법령명: "테스트법 시행규칙", 공포번호: "9" },
          { 별표번호: "000100", 별표종류: "별표", 관련법령명: "테스트법 시행규칙", 공포번호: no2 },
        ],
      },
    });
    const same = await checkRevisionDocs([BYL_DOC], ctxWith(createLawMock(serve("licbyl", rows("1")))));
    expect(same[0]!.state).toBe("confirmed");
    const changed = await checkRevisionDocs([BYL_DOC], ctxWith(createLawMock(serve("licbyl", rows("2")))));
    expect(changed[0]!.state).toBe("changed");
  });

  it("live-derived same/changed for law and admrul", async () => {
    const lawLive = JSON.parse(readFileSync(new URL("./fixtures/law/law/labor-standards-act.json", import.meta.url), "utf8")) as unknown;
    const admLive = JSON.parse(readFileSync(new URL("./fixtures/law/admrul/checkup.json", import.meta.url), "utf8")) as unknown;
    const LAW_LIVE = {
      ...LAW_DOC,
      id: "live-law",
      law_api: { kind: "law", law_name: "근로기준법", law_id: "001872", mst: "285279", effective: "2026-10-08" },
    } as BasisDoc;
    const ADM_LIVE = {
      ...ADM_DOC,
      id: "live-adm",
      law_api: { kind: "admrul", rule_id: "38208", name: "건강검진 실시기준", serial: "2100000272270", number: "제2026-6호", issued: "2026-01-07" },
    } as BasisDoc;

    const lawSame = await checkRevisionDocs([LAW_LIVE], ctxWith(createLawMock(serve("law", lawLive))));
    expect(lawSame[0]!.state).toBe("confirmed");
    const admSame = await checkRevisionDocs([ADM_LIVE], ctxWith(createLawMock(serve("admrul", admLive))));
    expect(admSame[0]!.state).toBe("confirmed");

    const lawDerived = structuredClone(lawLive) as { LawSearch: { law: Record<string, string>[] } };
    lawDerived.LawSearch.law.find((r) => r["법령ID"] === "001872")!["법령일련번호"] = "285280"; // 실응답 파생: 법령일련번호
    const lawChanged = await checkRevisionDocs([LAW_LIVE], ctxWith(createLawMock(serve("law", lawDerived))));
    expect(lawChanged[0]!.state).toBe("changed");

    const admDerived = structuredClone(admLive) as { AdmRulSearch: { admrul: Record<string, string> } };
    admDerived.AdmRulSearch.admrul["발령번호"] = "2026-7"; // 실응답 파생: admrul.발령번호
    const admChanged = await checkRevisionDocs([ADM_LIVE], ctxWith(createLawMock(serve("admrul", admDerived))));
    expect(admChanged[0]!.state).toBe("changed");
    expect(admChanged[0]!.link?.startsWith("https://www.law.go.kr/")).toBe(true);
    expect(admChanged[0]!.link).not.toContain("OC=");
  });
});
