# API 키로 기능 더하기(선택)

> 공공기관이 제공하는 공개 API와 자료를 이용해 정리해 드려요. 최종 확인은 해당 기관에서 해 주세요. 참고용 일반 정보예요. 건강 상태와 검진·접종 시기는 의료진과 상의하고, 신고·신청 기한과 요건은 관할 기관에 확인해 주세요.

키 4종 모두 선택입니다. 키가 없어도 `get_timeline` 등 [키 없이 바로 쓰는 기능](keyless.md)은 동작하며, 키가 없으면 해당 도구는 발급 안내를 돌려줍니다.

## 키가 필요한 도구

| 도구 | 하는 일 | 필요한 키(환경 변수) | 상태 |
| --- | --- | --- | --- |
| `find_night_pediatric` | 야간·휴일 소아 진료기관 찾기 | `DATA_GO_KR_SERVICE_KEY` | ✅ 확인됨 |
| `find_benefits` | 임신·출산·영유아 지원 서비스 찾기 | `DATA_GO_KR_SERVICE_KEY` | ✅ 확인됨(목록 조회만, 상세 조회 미확인) |
| `check_pregnancy_drug` | 임부금기 의약품 정보 조회 | `DATA_GO_KR_SERVICE_KEY` | ✅ 확인됨 |
| `find_local_support` | 시군구별 임신·출산·영유아 지원 서비스 찾기(참고용) | `DATA_GO_KR_SERVICE_KEY` | ✅ 확인됨 |
| `find_kindergarten` | 유치원 정원·현원·여석 추정 조회 | `KINDERGARTEN_API_KEY` | ✅ 확인됨 |
| `get_leave_article` | 출산·육아 휴가 근거 법 조문 조회 | `LAW_OC` | ✅ 확인됨 |
| `check_recall` | 어린이제품 리콜 이력 조회 | `SAFETYKOREA_AUTH_KEY` | ✅ 확인됨 |

✅ 확인됨: 실제 API 호출로 동작 확인 · ⏳ 키 승인 대기: 키 승인 전이라 실제 호출 미확인 · 🔗 링크 안내: 데이터를 조회하지 않고 공식 페이지 링크를 알려 줌

`check_recall`은 제품안전정보센터(SafetyKorea) 서비스 ID(`SAFETYKOREA_AUTH_KEY`)가 있어야 쓰는 선택 기능입니다.

## 키 발급

### 공공데이터포털 — `DATA_GO_KR_SERVICE_KEY`

1. https://www.data.go.kr 에서 회원가입 후 로그인합니다.
2. 아래 데이터셋마다 활용신청을 합니다. 승인 전 호출은 실패합니다.
3. 마이페이지 > 개발계정의 일반 인증키 **Decoding** 값을 그대로 설정합니다. Encoding 키를 넣으면 이중 인코딩 오류가 납니다.
4. 개발계정은 API별 일일 호출 한도가 있습니다. 부족하면 마이페이지에서 운영계정을 신청합니다.

| 데이터셋 | 도구 | 링크 |
| --- | --- | --- |
| 15000736 국립중앙의료원 전국 병·의원 찾기 | `find_night_pediatric` | https://www.data.go.kr/data/15000736/openapi.do |
| 15113968 대한민국 공공서비스(혜택) 정보 | `find_benefits` | https://www.data.go.kr/data/15113968/openapi.do |
| 15059486 DUR 품목정보 | `check_pregnancy_drug` | https://www.data.go.kr/data/15059486/openapi.do |
| 15012690 한국천문연구원 특일 정보 (공휴일 확인, 선택) | `get_timeline` | https://www.data.go.kr/data/15012690/openapi.do |
| 15154419 국민건강보험공단 검진기관 찾기 조회 (검진기관 조회, 선택) | `find_checkup_clinic` | https://www.data.go.kr/data/15154419/openapi.do |

### 유치원알리미 — `KINDERGARTEN_API_KEY`

1. https://e-childschoolinfo.moe.go.kr 에서 SNS 계정으로 로그인합니다.
2. OpenAPI 메뉴에서 인증키를 신청합니다.
3. 담당자 승인 후 키가 발급됩니다.
4. 발급받은 키를 공백 없이 설정합니다.

### 법제처 국가법령정보 공동활용 — `LAW_OC`

1. https://open.law.go.kr 에서 회원가입합니다.
2. OPEN API 신청에서 법령·행정규칙·별표서식을 체크합니다.
3. 호출하는 컴퓨터의 공인 IP 또는 도메인을 등록합니다. 미등록이면 "사용자 정보 검증에 실패" 응답이 옵니다.
4. OC 값은 가입 이메일의 @ 앞부분입니다.

### 제품안전정보센터(SafetyKorea) — `SAFETYKOREA_AUTH_KEY`

1. https://www.safetykorea.kr/release/openapi 에서 사용신청서를 작성합니다.
2. safetykorea@korea.kr 로 이메일 신청합니다.
3. 승인되면 서비스 ID가 이메일로 발급됩니다. 서비스 ID는 양도할 수 없습니다.
4. 발급받은 값을 설정합니다. 서버는 HTTP 헤더 `AuthKey`로만 보내며 주소에는 넣지 않습니다.

## 키 다루기

키는 환경 변수 또는 설정 마법사로만 전달하고, 저장소나 채팅에 적지 마세요. 설정 마법사는 [설정 마법사로 설치하기](setup-wizard.md)를 보세요.
