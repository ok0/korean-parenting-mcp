# Codex에 연결하기

> 이 문서는 정부·공공기관과 관계없는 비공식 개인 프로젝트의 안내입니다. 의료·법률 자문이 아니며, 건강 상태는 의료진에게, 제도·신청 기한은 관할 기관에 확인하세요.

[← 설치 방법 고르기](../install.md) · [AI 앱 목록](README.md)

Codex에 이 서버를 직접 추가하는 방법이에요.

이미 다른 방법(설정 마법사, 파일 하나로 설치 등)으로 등록했다면 다시 추가하지 마세요. 같은 서버가 두 번 등록될 수 있어요. 한 방법만 쓰세요.

## 설정 위치

설정 파일은 `~/.codex/config.toml`이에요. Codex 명령줄 도구와 IDE 확장이 함께 써요.

프로젝트별 `.codex/config.toml`은 신뢰한 프로젝트에서만 읽어요.

## 설정 예시(키 없이)

```toml
[mcp_servers.korean-parenting]
command = "npx"
args = ["-y", "korean-parenting-mcp"]
```

터미널에서 이 명령 한 줄로 추가할 수도 있어요.

```sh
codex mcp add korean-parenting -- npx -y korean-parenting-mcp
```

## 설정 예시(선택 키 포함)

아래 세 방법 중 하나만 골라 쓰세요.

방법 1: 설정 파일에 키를 직접 적어요.

```toml
[mcp_servers.korean-parenting]
command = "npx"
args = ["-y", "korean-parenting-mcp"]

[mcp_servers.korean-parenting.env]
DATA_GO_KR_SERVICE_KEY = "<발급받은 키>"
```

방법 2: 컴퓨터의 환경변수에 이미 키가 있으면 이름만 넘겨요.

```toml
[mcp_servers.korean-parenting]
command = "npx"
args = ["-y", "korean-parenting-mcp"]
env_vars = ["DATA_GO_KR_SERVICE_KEY"]
```

방법 3: 터미널 명령으로 키와 함께 추가해요.

```sh
codex mcp add korean-parenting --env "DATA_GO_KR_SERVICE_KEY=<발급받은 키>" -- npx -y korean-parenting-mcp
```

다른 키(`KINDERGARTEN_API_KEY`, `LAW_OC`, `SAFETYKOREA_AUTH_KEY`)도 같은 방법으로 넣어요. 키 발급은 [API 키로 기능 더하기(선택)](../advanced.md)를 보세요. 키가 없어도 일정 안내 기능은 그대로 써요.

## 적용하기

저장한 뒤 Codex를 새로 시작해요. IDE 확장은 편집기를 다시 시작해요.

## 연결 확인

AI에게 "출산예정일 2027-03-15 일정 알려줘"라고 물어보세요. `get_timeline` 도구가 불리면 연결된 거예요.

앱의 도구 목록에 `korean-parenting`이 보이는지도 확인할 수 있어요.

## 근거와 확인 수준

확인 수준: 공식 문서 근거

아래 공식 문서를 읽고 정리한 내용이에요. 이 프로젝트에서 직접 연결해 확인한 것은 아니에요.

<https://learn.chatgpt.com/docs/extend/mcp?surface=cli>
