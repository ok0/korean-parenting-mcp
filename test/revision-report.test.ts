import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../src/core/context.js";
import {
  buildIssueBody,
  checkRevisionDocs,
  ISSUE_MARKER,
  kstStamp,
  UNAVAILABLE_TEXT,
} from "../src/provenance/revision-check.js";
import type { BasisDoc } from "../src/data-store/schema.js";
import { createTestContext } from "./helpers/context.js";
import { createLawMock, htmlRes, jsonRes, type LawRoute } from "./helpers/law-mock.js";

const FAKE = "ab+c/d=e1";

beforeAll(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error("global fetch disabled");
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

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

function ctxWith(mock: { fetch: typeof fetch }, env: Record<string, string> = { LAW_OC: FAKE }): ToolContext {
  return { ...createTestContext({ env }), fetch: mock.fetch };
}

describe("revision report", () => {
  it("user verification failure maps to not_approved", async () => {
    const denied: LawRoute = () =>
      new Response("<html>사용자 정보 검증에 실패하였습니다</html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    const out = await checkRevisionDocs([LAW_DOC], ctxWith(createLawMock(denied)));
    expect(out[0]!.state).toBe("unavailable");
    expect(out[0]!.reason).toBe("not_approved");
    expect(out[0]!.message).toContain(UNAVAILABLE_TEXT.not_approved);
  });

  it("html 200 stays failed", async () => {
    const out = await checkRevisionDocs([LAW_DOC], ctxWith(createLawMock(() => htmlRes())));
    expect(out[0]!.reason).toBe("failed");
  });

  it("issue body lists changed docs with values, link, time and checklist", async () => {
    const mock = createLawMock(serve("law", lawBody("200", "20270101")));
    const out = await checkRevisionDocs([LAW_DOC, NOBASE_DOC], ctxWith(mock));
    const body = buildIssueBody(out, [LAW_DOC, NOBASE_DOC], new Date("2026-11-02T00:00:00Z"));
    expect(body).toContain(ISSUE_MARKER);
    expect(body).toContain("테스트법");
    expect(body).toContain("MST 100");
    expect(body).toContain("MST 200");
    expect(body).toContain("https://www.law.go.kr/");
    expect(body).toContain("확인 시각: 2026-11-02 09:00 KST");
    expect(body).toContain("- [ ] ");
    expect(body).toContain("기준없음법");
    expect(body).toContain("비교 기준 미등록");
    expect(body).not.toContain("OC=");
  });

  it("issue body is deterministic", async () => {
    const mock = createLawMock(serve("law", lawBody("200", "20270101")));
    const out = await checkRevisionDocs([LAW_DOC, NOBASE_DOC], ctxWith(mock));
    const at = new Date("2026-11-02T00:00:00Z");
    expect(buildIssueBody(out, [LAW_DOC, NOBASE_DOC], at)).toBe(buildIssueBody(out, [LAW_DOC, NOBASE_DOC], at));
  });

  it("kstStamp converts to KST", () => {
    expect(kstStamp(new Date("2026-12-31T15:30:00Z"))).toBe("2027-01-01 00:30 KST");
  });
});
