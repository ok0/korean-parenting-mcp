# 그 밖의 AI 앱에 연결하기

> 공공기관이 제공하는 공개 API와 자료를 이용해 정리해 드려요. 최종 확인은 해당 기관에서 해 주세요. 의료·법률 자문이 아니며, 건강 상태는 의료진에게, 제도·신청 기한은 관할 기관에 확인하세요.

[← 설치 방법 고르기](../install.md) · [AI 앱 목록](README.md)

여기 있는 앱들은 공식 문서(또는 다른 사람이 쓴 안내)만 읽고 정리했어요. 아직 직접 확인하지 못했으니 참고로만 봐 주세요.
어느 앱이든 같은 이름(`korean-parenting`)과 같은 실행 명령(`npx -y korean-parenting-mcp`)을 써요.
이미 다른 방법으로 등록했다면 다시 추가하지 마세요. 같은 서버가 두 번 등록될 수 있어요.

## Windsurf

Windsurf 설정 파일 위치는 공식 문서에서 찾지 못했어요. 공식 안내 주소는 지금 Devin 문서로 옮겨 갔고, 거기에는 Windsurf 설정 파일 이름이 나오지 않아요.

다른 사람이 쓴 안내에는 `~/.codeium/windsurf/mcp_config.json` 파일의 `mcpServers` 안에 넣으라고 나와 있어요. 이 위치는 확인되지 않았으니, 먼저 Windsurf의 MCP 설정 화면에서 실제 위치를 확인하세요.

파일에 이미 내용이 있으면 `mcpServers` 안에 `korean-parenting` 항목만 추가하세요.

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

아직 직접 확인하지 못했어요. 공식 문서에서 설정 위치를 찾지 못했고 다른 사람이 쓴 안내만 있어요. 이 프로젝트에서 연결해 보지도 않았어요.

출처(공식 안내가 옮겨 간 곳):

<https://docs.devin.ai/desktop/cascade/mcp>

출처(다른 사람이 쓴 안내):

<https://fast.io/resources/windsurf-mcp-setup-guide/>

## Zed

Zed 설정 파일의 `context_servers` 안에 추가해요. 설정 파일은 명령 팔레트에서 `zed: open settings file`을 실행하면 열려요. 또는 Settings > AI > MCP Servers > Add Server > Add Local Server 화면에서 추가할 수도 있어요.

공식 문서에는 npx 예시가 없어서, 아래 예시는 같은 모양으로 맞춘 거예요. 공식 문서에 따르면 키는 같은 항목의 `env`에 넣어요. 이 문서에서는 키 없이 쓰는 예시만 드려요. 키 이름은 [API 키로 기능 더하기(선택)](../advanced.md)를 보세요.

```json
{
  "context_servers": {
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

아직 직접 확인하지 못했어요. 공식 문서만 읽고 정리했고, 이 프로젝트에서 연결해 보지 않았어요.

출처(공식 문서):

<https://zed.dev/docs/ai/mcp>

## JetBrains AI Assistant

Settings | Tools | AI Assistant | Model Context Protocol (MCP)로 가서 Add를 누른 뒤 STDIO를 고르세요. JSON 입력칸에 `command`와 `args`를 넣어요. 서버 이름을 정하는 칸이 있다면 같은 `korean-parenting`을 쓰세요.

공식 문서에는 키(환경 변수)를 넣는 칸이 나와 있지 않아서, 키가 필요한 기능은 이 앱에서 다루지 않아요.

```json
{
  "command": "npx",
  "args": [
    "-y",
    "korean-parenting-mcp"
  ]
}
```

아직 직접 확인하지 못했어요. 공식 문서만 읽고 정리했고, 이 프로젝트에서 연결해 보지 않았어요.

출처(공식 문서):

<https://www.jetbrains.com/help/ai-assistant/mcp.html>

## 연결 확인

AI에게 "출산예정일 2027-03-15 일정 알려줘"라고 물어보세요.

`get_timeline` 도구가 불리면 연결된 거예요.
