import { describe, expect, it } from "vitest";
import type { BasisDoc } from "../src/data-store/schema.js";
import {
  DISCLAIMER_MEDICAL_LEGAL,
  NOTICE_NO_REVISION_CHECK,
  NOTICE_UNOFFICIAL,
  basisFooter,
  basisLine,
  composeFooter,
  revisionSummary,
  verifiedText,
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
    expect(NOTICE_UNOFFICIAL).toContain("비공식");
    expect(NOTICE_UNOFFICIAL).toContain("공식 기관");
    expect(NOTICE_NO_REVISION_CHECK).toContain("개정 여부 자동 확인은 아직 제공하지 않");
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
    expect(footer).toContain(NOTICE_NO_REVISION_CHECK);
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
    expect(footer).not.toContain(NOTICE_NO_REVISION_CHECK);
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
