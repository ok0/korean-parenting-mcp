# korean-parenting-mcp

한국 임신·출산·육아 일정과 공공 정보를 안내하는 MCP 서버입니다.

정부·공공기관과 관계없는 **비공식** 개인 프로젝트이며, 공공 API와 공개 법령을 바탕으로 안내합니다.

## 면책

- 의료 정보는 진료를 대체하지 않습니다. 건강 상태나 치료에 관한 판단은 반드시 의료진과 상담하세요.
- 법률·제도 정보는 법률 자문이 아닙니다. 실제 적용 여부, 신청 방법, 기한은 관할 기관에 확인하세요.

## 실행

```bash
npx -y korean-parenting-mcp
```

STDIO MCP 서버입니다. Node.js 20.19 이상이 필요합니다.

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

## API 키 (모두 선택)

| 환경 변수 | 발급처 |
| --- | --- |
| `DATA_GO_KR_SERVICE_KEY` | 공공데이터포털 |
| `KINDERGARTEN_API_KEY` | 유치원알리미 |
| `LAW_OC` | 국가법령정보 공동활용 |
| `SAFETYKOREA_AUTH_KEY` | 제품안전정보센터 |

키가 하나도 없어도 `get_timeline`은 동작하며, 키가 필요한 정보는 안내 메시지로 대신합니다.

## 라이선스

MIT — `LICENSE` 참조
