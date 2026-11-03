import { describe, expect, it } from "vitest";
import type { BasisDoc } from "../src/data-store/schema.js";
import { SPECS } from "../src/clients/data-go-kr-specs.js";
import { DRUG_REFERENCE_NOTICE, REFERENCE_NOTICE, SOURCE_NOTICE } from "../src/core/notice.js";
import {
  DISCLAIMER_DRUG,
  DISCLAIMER_MEDICAL_LEGAL,
  NOTICE_SOURCE,
  basisFooter,
  basisLine,
  composeFooter,
  partialNotice,
  revisionSummary,
  sourceFooter,
  summarizeList,
  verifiedText,
  zeroResultHint,
} from "../src/tools/shared/format.js";

const doc = {
  id: "x-doc",
  title: "테스트 법",
  doc_no: "법률 제1호",
  kind: "law",
  promulgated: "2026-08-04",
  effective: "2026-10-02",
  url: "https://example.go.kr/a",
  law_api: null,
  as_of: "2026-10-28",
  verified: "partial",
} as unknown as BasisDoc;

describe("format", () => {
  it("exports notices with required wording", () => {
    expect(DISCLAIMER_MEDICAL_LEGAL).toContain("면책");
    expect(DISCLAIMER_MEDICAL_LEGAL).toBe(`의료·법률 면책: ${REFERENCE_NOTICE}`);
    expect(DISCLAIMER_DRUG).toBe(`의약품 면책: ${DRUG_REFERENCE_NOTICE}`);
    expect(NOTICE_SOURCE).toBe(`${SOURCE_NOTICE} 정부24·복지로·국민건강보험공단·관할 주민센터·보건소에서 확인할 수 있어요.`);
  });

  it("basisLine renders id, title, doc_no, dates, as_of and verification", () => {
    const line = basisLine(doc);
    expect(line).toContain("[x-doc]");
    expect(line).toContain("테스트 법");
    expect(line).toContain("법률 제1호");
    expect(line).toContain("공포 2026-08-04");
    expect(line).toContain("시행 2026-10-02");
    expect(line).toContain("기준일 2026-10-28");
    expect(line).toContain("부분 검증");
    expect(line).not.toContain("개정 ");
  });

  it("basisLine marks missing verification", () => {
    const { verified: _verified, ...rest } = doc;
    expect(basisLine(rest as BasisDoc)).toContain("검증 상태 미기재");
    expect(verifiedText(undefined)).toBe("검증 상태 미기재");
  });

  it("basisFooter handles empty list", () => {
    const footer = basisFooter([]);
    expect(footer).toContain("근거 문서: 없음");
    expect(footer).not.toContain("자동 확인은 아직 제공하지 않");
  });

  it("composeFooter drops undefined and blank sections", () => {
    expect(composeFooter(["a", undefined, " ", "b"])).toBe("---\na\nb");
  });

  it("basisFooter with revisions", () => {
    const footer = basisFooter([doc], [
      {
        basisId: "x-doc",
        state: "changed",
        message: "근거가 개정되었습니다. 원문을 확인하세요 (저장 MST 1 → 현재 2)",
        link: "https://www.law.go.kr/x",
      },
    ]);
    expect(footer).toContain("개정 확인 요약: 원문 확인 0 / 개정됨 1 / 확인 불가 0 / 생략 0");
    const lines = footer.split("\n");
    const idx = lines.indexOf(basisLine(doc));
    expect(idx).toBeGreaterThanOrEqual(0);
    const next = lines[idx + 1] ?? "";
    expect(next.startsWith("  · 개정 확인: 근거가 개정되었습니다")).toBe(true);
    expect(next.endsWith(" 원문: https://www.law.go.kr/x")).toBe(true);
    expect(footer).not.toContain("자동 확인은 아직 제공하지 않");
  });

  it("revisionSummary counts each state", () => {
    expect(
      revisionSummary([
        { basisId: "a", state: "confirmed", message: "원문 확인됨" },
        { basisId: "b", state: "changed", message: "근거가 개정되었습니다. 원문을 확인하세요" },
        { basisId: "c", state: "unavailable", message: "개정 여부 확인 불가(법제처 조회 실패)" },
        { basisId: "d", state: "skipped", message: "법제처 OC 미설정: 개정 여부 확인 생략" },
      ]),
    ).toBe("개정 확인 요약: 원문 확인 1 / 개정됨 1 / 확인 불가 1 / 생략 1");
  });
});

describe("format list helpers", () => {
  it("sourceFooter lists attribution, titles, url and KST time", () => {
    const footer = sourceFooter([SPECS.nemcMoonlight, SPECS.nemcList], "2026-10-28 21:30");
    expect(footer).toContain(SPECS.nemcList.title);
    expect(footer).toContain(SPECS.nemcMoonlight.title);
    expect(footer).toContain("국립중앙의료원(공공데이터포털)");
    expect(footer).toContain("https://www.data.go.kr/data/15000736/openapi.do");
    expect(footer).toContain("조회 시각 2026-10-28 21:30 KST");
  });

  it("summarizeList shows top N and omitted count", () => {
    const rows = [1, 2, 3, 4, 5, 6, 7];
    const out = summarizeList(rows, { limit: 5, unit: "곳", line: (r) => `row ${r}` });
    expect(out.split("\n\n").slice(0, 5)).toHaveLength(5);
    expect(out).toContain("전체 후보 7곳 중 상위 5곳 표시(나머지 2곳 생략)");
    expect(summarizeList([1, 2], { limit: 5, unit: "곳", line: (r) => `row ${r}` })).toContain("전체 후보 2곳 모두 표시");
    expect(summarizeList([1, 2, 3], { limit: 5, total: 10, unit: "곳", line: (r) => `row ${r}` })).toContain("전체 후보 10곳 중 상위 3곳");
  });

  it("zeroResultHint is a normal lookup and lists suggestions", () => {
    const hint = zeroResultHint("야간 진료", ["시간을 바꿔 보세요", "지역을 넓혀 보세요"]);
    expect(hint).toContain("(정상 조회)");
    expect(hint).not.toMatch(/아니|아닌|아님|아닙/);
    expect(hint).toContain("- 시간을 바꿔 보세요");
    expect(hint).toContain("- 지역을 넓혀 보세요");
  });

  it("partialNotice names failed sections", () => {
    expect(partialNotice([])).toBe("");
    const notice = partialNotice([{ label: "달빛어린이병원", reason: "시간 초과", action: "잠시 후 다시 시도" }]);
    expect(notice).toContain("달빛어린이병원");
    expect(notice).toContain("시간 초과");
    expect(notice).toContain("조치:");
  });
});
