# Claude Code에 연결하기

> 공공기관이 제공하는 공개 API와 자료를 이용해 정리해 드려요. 최종 확인은 해당 기관에서 해 주세요. 의료·법률 자문이 아니며, 건강 상태는 의료진에게, 제도·신청 기한은 관할 기관에 확인하세요.

[← 설치 방법 고르기](../install.md) · [AI 앱 목록](README.md)

Claude Code에 이 서버를 직접 추가하는 방법이에요.

이미 다른 방법(설정 마법사, 파일 하나로 설치 등)으로 등록했다면 다시 추가하지 마세요. 같은 서버가 두 번 등록될 수 있어요. 한 방법만 쓰세요.

## 설정 위치

파일을 직접 고치지 않고 `claude mcp add` 명령으로 등록해요.

`--scope user`는 내 모든 프로젝트에서 쓰도록 사용자 범위에 등록한다는 뜻이에요.

## 설정 예시(키 없이)

```sh
claude mcp add --transport stdio --scope user korean-parenting -- npx -y korean-parenting-mcp
```

## 설정 예시(선택 키 포함)

```sh
claude mcp add --transport stdio --scope user --env "DATA_GO_KR_SERVICE_KEY=<발급받은 키>" korean-parenting -- npx -y korean-parenting-mcp
```

키는 명령 인자로 전달되어 같은 컴퓨터의 프로세스 목록에 잠시 보일 수 있어요.

다른 키(`KINDERGARTEN_API_KEY`, `LAW_OC`, `SAFETYKOREA_AUTH_KEY`)도 같은 방법으로 넣어요. 키 발급은 [API 키로 기능 더하기(선택)](../advanced.md)를 보세요. 키가 없어도 일정 안내 기능은 그대로 써요.

## 적용하기

터미널에서 위 명령을 실행한 뒤 Claude Code를 새로 시작해요.

## 연결 확인

AI에게 "출산예정일 2027-03-15 일정 알려줘"라고 물어보세요. `get_timeline` 도구가 불리면 연결된 거예요.

앱의 도구 목록에 `korean-parenting`이 보이는지도 확인할 수 있어요.

## 근거

아래 공식 문서를 읽고 정리한 내용이에요. 이 프로젝트에서 직접 연결해 확인한 것은 아니에요.

<https://code.claude.com/docs/en/mcp>
