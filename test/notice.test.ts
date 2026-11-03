import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CLINIC_REFERENCE_NOTICE,
  DRUG_REFERENCE_NOTICE,
  LEGAL_REFERENCE_NOTICE,
  POSITIVE_DISCLAIMER_MARKERS,
  RECALL_REFERENCE_NOTICE,
  REFERENCE_NOTICE,
  SOURCE_NOTICE,
} from "../src/core/notice.js";

describe("source notice", () => {
  it("SOURCE_NOTICE is the fixed positive wording", () => {
    expect(SOURCE_NOTICE).toBe("공공기관이 제공하는 공개 API와 자료를 이용해 정리해 드려요. 최종 확인은 해당 기관에서 해 주세요.");
  });

  it("notice.ts has no imports", () => {
    const text = readFileSync(fileURLToPath(new URL("../src/core/notice.ts", import.meta.url)), "utf8");
    expect(/^\s*import\s/m.test(text)).toBe(false);
  });

  it("SOURCE_NOTICE has no affiliation-negating wording", () => {
    expect(SOURCE_NOTICE).not.toMatch(/비공식|unofficial|아닙니다|아니며|관계없/i);
  });

  it("reference notices are fixed positive wording", () => {
    expect(REFERENCE_NOTICE).toBe("참고용 일반 정보예요. 건강 상태와 검진·접종 시기는 의료진과 상의하고, 신고·신청 기한과 요건은 관할 기관에 확인해 주세요.");
    expect(CLINIC_REFERENCE_NOTICE).toBe("참고용 일반 안내예요. 아이의 상태와 진료·처방, 접종·검진 시기는 의료진과 상의해 주세요.");
    expect(DRUG_REFERENCE_NOTICE).toBe("식약처 DUR 임부금기 공개 정보를 옮긴 참고용 정보예요. 복용 여부는 의사·약사와 상의해 정하고, 임의로 시작하거나 중단하지 마세요. 목록에서 찾지 못한 약도 복용 전에 의사·약사와 상의해 주세요.");
    expect(RECALL_REFERENCE_NOTICE).toBe("제품안전정보센터 공개 정보를 옮긴 참고용 정보예요. 리콜 여부와 구매·사용은 제품안전정보센터 사이트(https://www.safetykorea.kr)와 제조사·판매처에서 최종 확인해 주세요. 리콜 기록을 찾지 못한 제품도 사용 전에 제조사·판매처 안내를 함께 확인해 주세요.");
    expect(LEGAL_REFERENCE_NOTICE).toBe("조문 원문을 옮긴 참고용 정보예요. 법적 효력은 법령 원문에 있고, 적용 여부와 세부 요건은 사업장·고용센터(고용노동부)와 상의해 확인해 주세요.");
    expect(POSITIVE_DISCLAIMER_MARKERS).toEqual(["참고용", "상의"]);
  });

  it("reference notices carry markers and no negative stem", () => {
    for (const notice of [REFERENCE_NOTICE, CLINIC_REFERENCE_NOTICE, DRUG_REFERENCE_NOTICE, RECALL_REFERENCE_NOTICE, LEGAL_REFERENCE_NOTICE]) {
      expect(notice).toContain("참고용");
      expect(notice).not.toMatch(/아니|아닌|아님|아닙|비공식/);
    }
    for (const notice of [REFERENCE_NOTICE, CLINIC_REFERENCE_NOTICE, DRUG_REFERENCE_NOTICE, LEGAL_REFERENCE_NOTICE]) {
      expect(notice).toContain("상의");
    }
  });
});
