# Claude 데스크톱 앱에 연결하기(직접 설정)

> 공공기관이 제공하는 공개 API와 자료를 이용해 정리해 드려요. 최종 확인은 해당 기관에서 해 주세요. 의료·법률 자문이 아니며, 건강 상태는 의료진에게, 제도·신청 기한은 관할 기관에 확인하세요.

[← 설치 방법 고르기](../install.md) · [AI 앱 목록](README.md)

더 쉬운 방법이 있어요: [Claude 데스크톱 앱에 설치하기(파일 하나로)](../mcpb.md).

터미널 명령 한 줄이 괜찮다면 [설정 마법사로 설치하기](../setup-wizard.md)도 돼요. 이 문서는 설정 파일을 직접 고치는 방법이에요.

이미 다른 방법(설정 마법사, 파일 하나로 설치 등)으로 등록했다면 다시 추가하지 마세요. 같은 서버가 두 번 등록될 수 있어요. 한 방법만 쓰세요.

## 설정 위치

macOS에서는 `~/Library/Application Support/Claude/claude_desktop_config.json` 파일이에요.

Windows에서는 `%APPDATA%\Claude\claude_desktop_config.json` 파일이에요.

Linux에서는 경로를 아직 직접 확인하지 못했어요.

파일에 이미 내용이 있으면 `mcpServers` 안에 `korean-parenting` 항목만 추가하세요. 쉼표와 중괄호가 짝이 맞는지 확인하세요.

## 설정 예시(키 없이)

```json
{"mcpServers":{"korean-parenting":{"command":"npx","args":["-y","korean-parenting-mcp"]}}}
```

## 설정 예시(선택 키 포함)

```json
{"mcpServers":{"korean-parenting":{"command":"npx","args":["-y","korean-parenting-mcp"],"env":{"DATA_GO_KR_SERVICE_KEY":"<발급받은 키>"}}}}
```

다른 키(`KINDERGARTEN_API_KEY`, `LAW_OC`, `SAFETYKOREA_AUTH_KEY`)도 같은 방법으로 넣어요. 키 발급은 [API 키로 기능 더하기(선택)](../advanced.md)를 보세요. 키가 없어도 일정 안내 기능은 그대로 써요.

## 적용하기

저장한 뒤 앱을 완전히 종료했다가 다시 열어요. 창만 닫지 말고 메뉴에서 종료하세요.

## 연결 확인

AI에게 "출산예정일 2027-03-15 일정 알려줘"라고 물어보세요. `get_timeline` 도구가 불리면 연결된 거예요.

앱의 도구 목록에 `korean-parenting`이 보이는지도 확인할 수 있어요.

## 근거

아래 공식 문서를 읽고 정리한 내용이에요. 이 프로젝트에서 직접 연결해 확인한 것은 아니에요.

<https://modelcontextprotocol.io/docs/develop/connect-local-servers>
