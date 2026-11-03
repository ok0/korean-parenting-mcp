export const SOURCE_NOTICE = "공공기관이 제공하는 공개 API와 자료를 이용해 정리해 드려요. 최종 확인은 해당 기관에서 해 주세요.";
export const REFERENCE_NOTICE = "참고용 일반 정보예요. 건강 상태와 검진·접종 시기는 의료진과 상의하고, 신고·신청 기한과 요건은 관할 기관에 확인해 주세요.";
export const CLINIC_REFERENCE_NOTICE = "참고용 일반 안내예요. 아이의 상태와 진료·처방, 접종·검진 시기는 의료진과 상의해 주세요.";
export const DRUG_REFERENCE_NOTICE = "식약처 DUR 임부금기 공개 정보를 옮긴 참고용 정보예요. 복용 여부는 의사·약사와 상의해 정하고, 임의로 시작하거나 중단하지 마세요. 목록에서 찾지 못한 약도 복용 전에 의사·약사와 상의해 주세요.";
export const RECALL_REFERENCE_NOTICE = "제품안전정보센터 공개 정보를 옮긴 참고용 정보예요. 리콜 여부와 구매·사용은 제품안전정보센터 사이트(https://www.safetykorea.kr)와 제조사·판매처에서 최종 확인해 주세요. 리콜 기록을 찾지 못한 제품도 사용 전에 제조사·판매처 안내를 함께 확인해 주세요.";
export const LEGAL_REFERENCE_NOTICE = "조문 원문을 옮긴 참고용 정보예요. 법적 효력은 법령 원문에 있고, 적용 여부와 세부 요건은 사업장·고용센터(고용노동부)와 상의해 확인해 주세요.";
export const POSITIVE_DISCLAIMER_MARKERS = ["참고용", "상의"] as const;
export const HEALTH_CENTER_UNRESOLVED_LINKS = "복지로(https://www.bokjiro.go.kr)와 정부24(https://www.gov.kr)에서도 확인할 수 있어요.";
export const HEALTH_CENTER_PREPARING = "이 지역 보건소 연락처는 아직 준비 중이에요. 시군구청 누리집에서 확인하세요.";
export function healthCenterNotice(asOf: string): string {
  return `보건소 연락처는 공공데이터 목록(기준일 ${asOf})에서 옮긴 참고용 정보예요. 전화번호와 운영시간은 바뀔 수 있으니 방문 전에 보건소 홈페이지에서 확인하세요. 산전검사 같은 사업 여부와 조건은 보건소에 문의하세요.`;
}
export const LOCAL_SUPPORT_POINTER = "선택 기능: 공공데이터포털 서비스 키를 설정하면 find_local_support 도구로 이 지역의 지원 서비스를 참고용으로 찾아볼 수 있어요.";
export const LOCAL_SUPPORT_NOTICE = "공공기관이 제공하는 기능(공개 API)을 이용해 정리한 참고용 정보예요. 신청 조건과 금액은 해당 지자체에 확인하세요.";
export const LOCAL_SUPPORT_FRESHNESS = "지자체 지원은 자주 바뀌어요. 지금 신청할 수 있는지와 금액·조건은 복지로 상세와 해당 지자체 공고에서 확인하세요.";
export const LOCAL_SUPPORT_STALE_MARK = "수정일이 1년 넘게 지났어요. 지금 내용은 해당 지자체에 확인하세요.";
