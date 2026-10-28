export const SERVER_INSTRUCTIONS: string = [
  "korean-parenting-mcp는 한국 임신·출산·육아 일정과 공공 정보를 안내하는 비공식 MCP 서버입니다.",
  "비공식 도구 고지: 이 서버는 정부·공공기관의 공식 서비스가 아니며 결과는 참고용입니다. 신청 기한·지원 금액·의료 판단은 공식 기관(정부24, 복지로, 국민건강보험공단, 관할 주민센터·보건소)과 의료진에게 확인하세요.",
  "사용 순서: 임신 중이면 출산예정일(due_date), 출산 후면 아기 생년월일(birth_date) 중 하나로 먼저 get_timeline을 호출해 일정·기한을 확인한 뒤, 필요한 경우 다른 도구를 고르세요. 배우자 출산휴가·출산전후휴가·육아휴직의 근거 법 조문 원문이 필요하면 get_leave_article(LAW_OC 필요)을 사용하세요. 지역의 야간·휴일 소아 진료기관(달빛어린이병원·소아청소년과)과 지금 진료 여부가 필요하면 find_night_pediatric(DATA_GO_KR_SERVICE_KEY 필요)을 사용하세요. 사용 가능한 도구는 tools/list 결과를 기준으로 하세요.",
  "API 키: LAW_OC(법제처)는 get_leave_article에 필요하고, 있으면 get_timeline이 근거 문서 개정 여부를 확인합니다(없으면 확인 생략). DATA_GO_KR_SERVICE_KEY(공공데이터포털)는 find_night_pediatric에 필요하고, 있으면 get_timeline이 공휴일을 실시간으로 확인합니다. KINDERGARTEN_API_KEY(유치원알리미), SAFETYKOREA_AUTH_KEY(제품안전정보센터)는 이후 추가되는 도구가 사용합니다. 키가 없으면 해당 도구가 설정 방법을 안내합니다.",
].join("\n");
