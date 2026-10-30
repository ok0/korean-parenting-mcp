# Claude 데스크톱 앱에 설치하기(파일 하나로)

> 이 문서는 정부·공공기관과 관계없는 비공식 개인 프로젝트의 안내입니다. 의료·법률 자문이 아니며, 건강 상태는 의료진에게, 제도·신청 기한은 관할 기관에 확인하세요.

[← 설치 방법 고르기](install.md)

Claude 데스크톱 앱에서는 파일 하나(`.mcpb` 확장 파일)로 설치할 수 있습니다.

## 미리 만든 파일(준비 중)

미리 만든 설치 파일(`korean-parenting-mcp.mcpb`)은 [이 주소](https://github.com/ok0/korean-parenting-mcp/releases/download/mcpb-latest/korean-parenting-mcp.mcpb)에 올릴 예정입니다. 아직 게시 전이므로 지금은 아래 개발자 빌드로 만들어 설치하세요.

## 개발자 빌드로 설치

1. 저장소를 내려받아 `npm ci` 후 `npm run pack:mcpb`를 실행하면 `build-mcpb/korean-parenting-mcp.mcpb`가 만들어집니다.
2. Claude 데스크톱 앱에서 이 파일을 열어 설치합니다.
3. 설치 화면의 API 키 입력 칸 4개는 모두 선택 사항입니다. 비워 둬도 `get_timeline`처럼 키 없이 동작하는 기능을 쓸 수 있고, 입력한 키는 민감 정보로 저장됩니다. 키 발급 방법은 [API 키로 기능 더하기(선택)](advanced.md)을 보세요.

Claude 데스크톱 앱 설치 확인은 아직 수동 점검 단계입니다.
