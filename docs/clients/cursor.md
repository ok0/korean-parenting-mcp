# Cursor에 연결하기

> 이 문서는 정부·공공기관과 관계없는 비공식 개인 프로젝트의 안내입니다. 의료·법률 자문이 아니며, 건강 상태는 의료진에게, 제도·신청 기한은 관할 기관에 확인하세요.

[← 설치 방법 고르기](../install.md) · [AI 앱 목록](README.md)

Cursor의 AI가 이 서버를 쓰도록 Cursor MCP 설정 파일에 추가하는 방법이에요.
이미 다른 방법(설정 마법사, 파일 하나로 설치 등)으로 등록했다면 다시 추가하지 마세요. 같은 서버가 두 번 등록될 수 있어요. 한 방법만 쓰세요.

Cursor를 쓰고 있다면 아래 링크로 바로 추가해 볼 수 있어요.

[Cursor에 설치하기](https://cursor.com/en/install-mcp?name=korean-parenting&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsImtvcmVhbi1wYXJlbnRpbmctbWNwIl19)

버튼이 열리지 않으면 아래 설정을 복사해 붙여 넣으세요.

## 설정 위치

모든 프로젝트에서 쓰려면 `~/.cursor/mcp.json` 파일을 고치세요.

한 프로젝트에서만 쓰려면 그 프로젝트 안의 `.cursor/mcp.json` 파일을 고치세요.

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

다른 키(`KINDERGARTEN_API_KEY`, `LAW_OC`, `SAFETYKOREA_AUTH_KEY`)도 같은 방법으로 넣어요. 키 발급은 [API 키로 기능 더하기(선택)](../advanced.md)를 보세요. 키가 없어도 일정 안내 기능은 그대로 써요.

키를 파일에 직접 쓰기 싫으면 값 자리에 `${env:DATA_GO_KR_SERVICE_KEY}`라고 쓰세요. 그러면 컴퓨터의 환경변수에서 키를 읽어요.

## 적용하기

저장한 뒤 Cursor를 완전히 닫았다가 다시 여세요.

설정의 MCP 항목에서 `korean-parenting`이 켜져 있는지 확인해요.

## 연결 확인

AI에게 "출산예정일 2027-03-15 일정 알려줘"라고 물어보세요.

`get_timeline` 도구가 불리면 연결된 거예요.

앱의 도구 목록에 `korean-parenting`이 보이는지도 확인할 수 있어요.

## 근거

아래 공식 문서를 읽고 정리한 내용이에요. 이 프로젝트에서 직접 연결해 확인한 것은 아니에요.

<https://cursor.com/docs/context/mcp>
