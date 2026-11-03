# VS Code에 연결하기

> 공공기관이 제공하는 공개 API와 자료를 이용해 정리해 드려요. 최종 확인은 해당 기관에서 해 주세요. 참고용 일반 정보예요. 건강 상태와 검진·접종 시기는 의료진과 상의하고, 신고·신청 기한과 요건은 관할 기관에 확인해 주세요.

[← 설치 방법 고르기](../install.md) · [AI 앱 목록](README.md)

VS Code의 AI 채팅이 이 서버를 쓰도록 VS Code 설정 파일에 추가하는 방법이에요.
이미 다른 방법(설정 마법사, 파일 하나로 설치 등)으로 등록했다면 다시 추가하지 마세요. 같은 서버가 두 번 등록될 수 있어요. 한 방법만 쓰세요.

VS Code를 쓰고 있다면 아래 링크로 바로 추가해 볼 수 있어요.

[VS Code에 설치하기](https://insiders.vscode.dev/redirect?url=vscode%3Amcp%2Finstall%3F%257B%2522name%2522%253A%2522korean-parenting%2522%252C%2522type%2522%253A%2522stdio%2522%252C%2522command%2522%253A%2522npx%2522%252C%2522args%2522%253A%255B%2522-y%2522%252C%2522korean-parenting-mcp%2522%255D%257D)

버튼이 열리지 않으면 아래 설정을 복사해 붙여 넣으세요.

## 설정 위치

명령 팔레트(Ctrl/Cmd+Shift+P)를 열고 "MCP: Open User Configuration"을 고르면 사용자 설정 파일이 열려요. 모든 작업 폴더에서 쓸 수 있어요.

한 작업 폴더에서만 쓰려면 그 폴더의 `.vscode/mcp.json` 파일을 쓰세요.

파일에 이미 내용이 있으면 `servers` 안에 `korean-parenting` 항목만 추가하세요. 쉼표와 중괄호가 짝이 맞는지 확인하세요.

터미널에서 이 명령 한 줄로 추가할 수도 있어요.

```sh
code --add-mcp '{"name":"korean-parenting","type":"stdio","command":"npx","args":["-y","korean-parenting-mcp"]}'
```

## 설정 예시(키 없이)

```json
{
  "servers": {
    "korean-parenting": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "korean-parenting-mcp"
      ]
    }
  }
}
```

## 설정 예시(선택 키 포함)

```json
{
  "servers": {
    "korean-parenting": {
      "type": "stdio",
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

다른 키(`KINDERGARTEN_API_KEY`, `LAW_OC`, `SAFETYKOREA_AUTH_KEY`)도 같은 방법으로 넣어요. 키 발급은 [API 키로 기능 더하기(선택)](../advanced.md)를 보세요. 키가 없어도 일정 안내 기능은 그대로 써요.

## 적용하기

파일을 저장한 뒤 VS Code 창을 다시 불러오세요. 명령 팔레트에서 "Developer: Reload Window"를 고르면 돼요. VS Code를 완전히 껐다가 다시 켜도 돼요.

채팅을 에이전트 모드로 두고 도구 목록에서 켜져 있는지 봐요.

## 연결 확인

AI에게 "출산예정일 2027-03-15 일정 알려줘"라고 물어보세요.

`get_timeline` 도구가 불리면 연결된 거예요.

앱의 도구 목록에 `korean-parenting`이 보이는지도 확인할 수 있어요.

## 근거

아래 공식 문서를 읽고 정리한 내용이에요. 최종 동작은 각 앱의 공식 문서에서 확인해 주세요.

<https://code.visualstudio.com/docs/copilot/customization/mcp-servers>

<https://code.visualstudio.com/docs/agents/reference/mcp-configuration>
