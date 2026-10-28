import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { BasisDoc } from "../src/data-store/schema.js";
import { checkRevisionDocs, type RevisionStatus } from "../src/provenance/revision-check.js";
import { createTestContext } from "./helpers/context.js";
import { createLawMock, jsonRes, type LawRoute } from "./helpers/law-mock.js";

const OC = "oc+te/st=1";
const FORMS = (x: string): string[] => [x, encodeURIComponent(x), new URLSearchParams({ k: x }).toString().slice(2)];

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

function bylRoute(promulgationNo: string, extra: Record<string, string> = {}): LawRoute {
  const row = {
    별표번호: "0001",
    관련법령명: "테스트법 시행규칙",
    공포일자: "20270101",
    공포번호: promulgationNo,
    별표법령상세링크: `/LSW/lsBylInfoP.do?OC=${encodeURIComponent(OC)}&bylSeq=1`,
    ...extra,
  };
  return (url) => (url.searchParams.get("target") === "licbyl" ? jsonRes({ LicBylSearch: { totalCnt: "1", licbyl: [row] } }) : undefined);
}

async function run(route: LawRoute): Promise<RevisionStatus> {
  const mock = createLawMock(route);
  const ctx = { ...createTestContext({ env: { LAW_OC: OC } }), fetch: mock.fetch };
  const out = await checkRevisionDocs([BYL_DOC], ctx);
  return out[0]!;
}

describe("licbyl attachment links", () => {
  beforeAll(() => {
    vi.stubGlobal("fetch", () => {
      throw new Error("global fetch disabled");
    });
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("changed licbyl carries OC-free attachment links", async () => {
    const status = await run(
      bylRoute("2", {
        별표서식PDF파일링크: `/LSW/flDownload.do?OC=${encodeURIComponent(OC)}&flSeq=111`,
        별표서식파일링크: `/LSW/flDownload.do?oc=${encodeURIComponent(OC)}&flSeq=112`,
      }),
    );
    expect(status.state).toBe("changed");
    expect(status.attachment).toEqual({
      pdfLink: "https://www.law.go.kr/LSW/flDownload.do?flSeq=111",
      fileLink: "https://www.law.go.kr/LSW/flDownload.do?flSeq=112",
    });
    const blob = JSON.stringify(status);
    for (const form of FORMS(OC)) expect(blob.includes(form)).toBe(false);
  });

  it("no links → no attachment", async () => {
    const status = await run(bylRoute("2"));
    expect(status.state).toBe("changed");
    expect(status.attachment).toBeUndefined();
  });

  it("confirmed has no attachment", async () => {
    const status = await run(
      bylRoute("1", {
        별표서식PDF파일링크: `/LSW/flDownload.do?OC=${encodeURIComponent(OC)}&flSeq=111`,
      }),
    );
    expect(status.state).toBe("confirmed");
    expect(status.attachment).toBeUndefined();
  });

  it("foreign host link dropped", async () => {
    const status = await run(bylRoute("2", { 별표서식PDF파일링크: "https://evil.test/a" }));
    expect(status.state).toBe("changed");
    expect(status.attachment).toBeUndefined();
  });
});
