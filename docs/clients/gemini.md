# Gemini CLI·Gemini Code Assist에 연결하기

> 공공기관이 제공하는 공개 API와 자료를 이용해 정리해 드려요. 최종 확인은 해당 기관에서 해 주세요. 의료·법률 자문이 아니며, 건강 상태는 의료진에게, 제도·신청 기한은 관할 기관에 확인하세요.

[← 설치 방법 고르기](../install.md) · [AI 앱 목록](README.md)

Gemini CLI와 VS Code의 Gemini Code Assist(에이전트 모드)는 같은 설정 파일을 써요.
이미 다른 방법(설정 마법사, 파일 하나로 설치 등)으로 등록했다면 다시 추가하지 마세요. 같은 서버가 두 번 등록될 수 있어요. 한 방법만 쓰세요.

## 설정 위치

내 모든 작업에서 쓰려면 `~/.gemini/settings.json` 파일을 고치세요.

Gemini CLI는 프로젝트별 `.gemini/settings.json`도 쓸 수 있어요.

Gemini Code Assist는 명령 팔레트로 MCP 서버를 추가할 수 없어서 이 파일을 직접 고쳐요.

파일에 이미 내용이 있으면 `mcpServers` 안에 `korean-parenting` 항목만 추가하세요. 쉼표와 중괄호가 짝이 맞는지 확인하세요.

## 설정 예시(키 없이)

```json
{
  "mcpServers": {
    "korean-parenting": {
      "command": "npx",
      "args": [
        "-y",
        "korean-parenting-mcp"
      ]
    }
  }
}
```

Gemini CLI에서는 명령으로도 추가할 수 있어요.

```sh
gemini mcp add -s user korean-parenting npx -y korean-parenting-mcp
```

## 설정 예시(선택 키 포함)

```json
{
  "mcpServers": {
    "korean-parenting": {
      "command": "npx",
      "args": [
        "-y",
        "korean-parenting-mcp"
      ],
      "env": {
        "DATA_GO_KR_SERVICE_KEY": "<발급받은 키>"
      }
    }
  }
}
```

Gemini CLI에서는 명령으로도 추가할 수 있어요.

```sh
gemini mcp add -s user -e "DATA_GO_KR_SERVICE_KEY=<발급받은 키>" korean-parenting npx -y korean-parenting-mcp
```

다른 키(`KINDERGARTEN_API_KEY`, `LAW_OC`, `SAFETYKOREA_AUTH_KEY`)도 같은 방법으로 넣어요. 키 발급은 [API 키로 기능 더하기(선택)](../advanced.md)를 보세요. 키가 없어도 일정 안내 기능은 그대로 써요.

## 적용하기

Gemini CLI는 종료했다가 다시 실행하세요.

Gemini Code Assist는 명령 팔레트에서 "Developer: Reload Window"를 골라 창을 다시 불러오세요.

## 연결 확인

AI에게 "출산예정일 2027-03-15 일정 알려줘"라고 물어보세요.

`get_timeline` 도구가 불리면 연결된 거예요.

앱의 도구 목록에 `korean-parenting`이 보이는지도 확인할 수 있어요.

## 근거

아래 공식 문서를 읽고 정리한 내용이에요. 이 프로젝트에서 직접 연결해 확인한 것은 아니에요.

<https://geminicli.com/docs/tools/mcp-server/>

<https://docs.cloud.google.com/gemini/docs/codeassist/use-agentic-chat-pair-programmer>
