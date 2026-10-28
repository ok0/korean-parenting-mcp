import { describe, expect, it } from "vitest";
import type { BasisDoc } from "../src/data-store/schema.js";
import {
  DISCLAIMER_MEDICAL_LEGAL,
  NOTICE_NO_REVISION_CHECK,
  NOTICE_UNOFFICIAL,
  basisFooter,
  basisLine,
  composeFooter,
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
});
