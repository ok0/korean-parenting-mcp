# 설정 마법사로 설치하기

> 이 문서는 정부·공공기관과 관계없는 비공식 개인 프로젝트의 안내입니다. 의료·법률 자문이 아니며, 건강 상태는 의료진에게, 제도·신청 기한은 관할 기관에 확인하세요.

[← 설치 방법 고르기](install.md)

터미널에서 API 키 입력과 AI 앱 등록을 한 번에 하는 대화형 도구입니다.

```bash
npx -y korean-parenting-mcp setup
```

## 동작

- 대화형 터미널에서만 동작합니다. 터미널이 아니면 아무것도 기록하지 않고 종료합니다.
- API 키 4종을 하나씩 묻습니다. 키가 없으면 Enter로 건너뛸 수 있습니다.
- 키 입력은 `*`로 가려집니다. 화면에는 앞 4자와 길이만 표시하며, 8자 미만이면 `***`만 표시합니다.
- 등록 대상을 고를 수 있습니다. 현재 지원하는 앱은 아래 두 가지입니다.
  - **Claude 데스크톱 앱**: 설정 파일의 기존 항목을 보존하면서 `korean-parenting` 항목만 병합합니다. 기존 파일은 `.bak`으로 백업하고, 파일 권한은 소유자만 읽고 쓸 수 있게(0600) 씁니다. 적용하려면 Claude 데스크톱 앱을 완전히 종료한 뒤 다시 실행하세요.
  - **Claude Code**: `claude mcp add --scope user`로 사용자 범위에 등록합니다. 입력한 키는 등록 명령의 인자로 잠시 전달되므로 같은 컴퓨터의 프로세스 목록에 보일 수 있습니다. `claude` 명령이 없으면 등록하지 않고, 키 자리를 `<…>`로 비운 수동 명령을 출력합니다.

## 설정 파일 경로

Claude 데스크톱 앱의 설정 파일 위치입니다.

  - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
  - Windows: `%APPDATA%\Claude\claude_desktop_config.json`
  - Linux: `~/.config/Claude/claude_desktop_config.json`
  - Linux 경로는 미검증입니다.

## 네트워크

설정 마법사는 네트워크 호출을 하지 않습니다.

## 중복 등록 주의

설정 마법사는 이 서버를 `korean-parenting` 이름으로 이미 등록합니다. 같은 서버를 [직접 설정하기(AI 앱별)](clients/README.md)의 수동 설정으로 다시 등록하면 같은 서버 항목이 중복으로 생길 수 있습니다. 설정 마법사와 수동 설정 중 한 방법만 쓰세요.

API 키 발급 방법은 [API 키로 기능 더하기(선택)](advanced.md)를 보세요.
