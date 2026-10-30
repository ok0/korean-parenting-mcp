# korean-parenting-mcp

**한국 임신·출산·육아 정보 MCP 서버** (Korean pregnancy & parenting info MCP server)

정부·공공기관과 관계없는 **비공식** 개인 프로젝트이며, 공공 API와 공개 법령을 바탕으로 안내합니다.

[브라우저에서 체험해 보기](https://ok0.github.io/korean-parenting-mcp/): 출산예정일을 넣으면 맞춤 일정 예시를 이 브라우저 안에서 계산해 보여 줍니다. 설치가 필요 없고, 입력값은 어디에도 전송·저장되지 않습니다.

## 면책

- 의료 정보는 진료를 대체하지 않습니다. 건강 상태나 치료에 관한 판단은 반드시 의료진과 상담하세요.
- 법률·제도 정보는 법률 자문이 아닙니다. 실제 적용 여부, 신청 방법, 기한은 관할 기관에 확인하세요.

## 키 없이 쓰는 기능

API 키 없이 설치 즉시 동작합니다. 아래 기능은 키를 설정하지 않아도 됩니다.

- (i) 실제 API 호출로 동작 확인
- (ii) 모의 응답으로만 검증(실호출 미확인)
- (iii) 링크 안내 전용(데이터를 조회하지 않음)

| 도구 | 하는 일 | 상태 |
| --- | --- | --- |
| `get_timeline` | 출생일·출산 예정일 기준 임신·육아 일정 안내 | 정적 데이터(호출 없음). 공공데이터포털 키가 있으면 공휴일 실시간 확인 (i) |
| `find_daycare` | 어린이집 찾기·입소대기 링크 안내 | (iii) |
| `find_vaccination_clinic` | 예방접종 위탁의료기관 찾기 링크 안내 | (iii) |
| `find_checkup_clinic` | 영유아 건강검진 기관 찾기 안내 | (iii) |

### 사용 예

- "2026년 3월 15일에 출산했어. 앞으로 받을 예방접종과 검진 일정을 알려줘."
- "출산 예정일이 2027년 2월 10일이야. 지금 임신 중에 챙길 일정을 정리해줘."
- "육아휴직 기간과 관련해 필요한 일정을 날짜 순서로 보여줘."

## 그림으로 보기

MCP를 지원하는 AI 도우미에 연결하면, AI 도우미가 질문에 맞는 도구를 골라 답을 만듭니다. 아래 그림은 예시이며 실제 답은 질문과 날짜에 따라 달라집니다.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/ok0/korean-parenting-mcp/main/assets/tool-map-dark.svg">
  <img src="https://raw.githubusercontent.com/ok0/korean-parenting-mcp/main/assets/tool-map-light.svg" alt="부모의 질문을 AI 도우미가 받아 알맞은 도구를 고르고, 도구가 미리 담아 둔 정보나 공공기관 자료로 답하는 흐름을 한 장에 그린 지도입니다." width="800">
</picture>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/ok0/korean-parenting-mcp/main/assets/life-timeline-dark.svg">
  <img src="https://raw.githubusercontent.com/ok0/korean-parenting-mcp/main/assets/life-timeline-light.svg" alt="출산예정일 예시 하나로 계산한 임신부터 학령기 전까지의 검진·예방접종·신고와 신청 기한·지원금·휴가·어린이집과 유치원 안내 일정을 시간 순서로 보여 주는 그림입니다." width="800">
</picture>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/ok0/korean-parenting-mcp/main/assets/question-stories-dark.svg">
  <img src="https://raw.githubusercontent.com/ok0/korean-parenting-mcp/main/assets/question-stories-light.svg" alt="새벽에 열이 나는 아이, 출산예정일 이후 할 일, 중고 카시트 리콜처럼 예시 질문이 어떤 도구와 출처를 거쳐 답이 되는지 따라가는 그림입니다." width="800">
</picture>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/ok0/korean-parenting-mcp/main/assets/report-example-dark.svg">
  <img src="https://raw.githubusercontent.com/ok0/korean-parenting-mcp/main/assets/report-example-light.svg" alt="AI 도우미에게 보낸 예시 요청(출산예정일, 서울 성동구, 첫째)과 그 요청으로 만든 한 장 준비 보고서 예시입니다." width="800">
</picture>

## 설치와 실행

```bash
npx -y korean-parenting-mcp
```

STDIO MCP 서버입니다. Node.js 20.19 이상이 필요합니다.

MCP를 지원하는 AI 앱이면 이 명령을 STDIO 서버로 등록해 쓸 수 있습니다(예: Claude Desktop, Claude Code 등). 앱마다 등록 방법이 다르니 각 앱의 MCP 설정 안내를 따르세요.

## 설정 마법사

```bash
npx -y korean-parenting-mcp setup
```

- 대화형 터미널에서만 동작합니다. 터미널이 아니면 아무것도 기록하지 않고 종료합니다.
- API 키 4종을 하나씩 묻습니다. 키가 없으면 Enter로 건너뛸 수 있습니다.
- 키 입력은 `*`로 가려집니다. 화면에는 앞 4자와 길이만 표시하며, 8자 미만이면 `***`만 표시합니다.
- 등록 대상을 고를 수 있습니다.
  - **Claude Desktop**: 설정 파일의 기존 항목을 보존하면서 `korean-parenting` 항목만 병합합니다. 기존 파일은 `.bak`으로 백업하고, 파일 권한은 소유자 전용 0600으로 씁니다. 적용하려면 Claude Desktop을 완전히 종료한 뒤 다시 실행하세요.
  - **Claude Code**: `claude mcp add --scope user`로 사용자 범위에 등록합니다. 입력한 키는 등록 명령의 인자로 잠시 전달되므로 같은 컴퓨터의 프로세스 목록에 보일 수 있습니다. `claude` 명령이 없으면 등록하지 않고, 키 자리를 `<…>`로 비운 수동 명령을 출력합니다.
- 설정 파일 경로
  - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
  - Windows: `%APPDATA%\Claude\claude_desktop_config.json`
  - Linux: `~/.config/Claude/claude_desktop_config.json`
  - Linux 경로는 미검증입니다.
- 설정 마법사는 네트워크 호출을 하지 않습니다.

## Claude Desktop 확장(.mcpb)

Claude Desktop에서는 `.mcpb` 확장 파일로도 설치할 수 있습니다.

1. 저장소를 내려받아 `npm ci` 후 `npm run pack:mcpb`를 실행하면 `build-mcpb/korean-parenting-mcp.mcpb`가 만들어집니다.
2. Claude Desktop에서 이 파일을 열어 설치합니다.
3. 설치 화면의 API 키 입력 칸 4개는 모두 선택 사항입니다. 비워 둬도 `get_timeline`처럼 키 없이 동작하는 기능을 쓸 수 있고, 입력한 키는 민감 정보로 저장됩니다.

Claude Desktop 설치 확인은 아직 수동 점검 단계입니다.

## 선택·고급 기능 (API 키 필요)

키 4종 모두 선택입니다. 키가 없어도 `get_timeline` 등 위 기능은 동작하며, 키가 없으면 해당 도구는 발급 안내를 돌려줍니다.

| 도구 | 하는 일 | 필요한 키(환경 변수) | 상태 |
| --- | --- | --- | --- |
| `find_night_pediatric` | 야간·휴일 소아 진료기관 찾기 | `DATA_GO_KR_SERVICE_KEY` | (i) 실제 API 호출로 동작 확인 |
| `find_benefits` | 임신·출산·영유아 지원 서비스 찾기 | `DATA_GO_KR_SERVICE_KEY` | (i) 목록 조회 확인(상세 조회 미확인) |
| `check_pregnancy_drug` | 임부금기 의약품 정보 조회 | `DATA_GO_KR_SERVICE_KEY` | (i) 실제 API 호출로 동작 확인 |
| `find_kindergarten` | 유치원 정원·현원·여석 추정 조회 | `KINDERGARTEN_API_KEY` | (i) 실제 API 호출로 동작 확인 |
| `get_leave_article` | 출산·육아 휴가 근거 법 조문 조회 | `LAW_OC` | (i) 실제 API 호출로 동작 확인 |
| `check_recall` | 어린이제품 리콜 이력 조회 | `SAFETYKOREA_AUTH_KEY` | (ii) 키 승인 대기 — 모의 응답으로만 검증 |

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

키는 환경 변수 또는 설정 마법사로만 전달하고, 저장소나 채팅에 적지 마세요.

## 라이선스

MIT — `LICENSE` 참조
