# 보안 정책

한국 육아 일정 도우미(`korean-parenting-mcp`)의 보안 문제를 알려 주셔서 고맙습니다. 아래 안내에 따라 알려 주시면 확인한 뒤 함께 고쳐 나가요.

## 지원 버전

보안 수정은 npm `latest` 태그의 최신 버전과 최신 `.mcpb` 릴리스에 반영해요. 최신 버전을 쓰시면 수정 사항을 바로 받을 수 있어요.

- npm: Node.js 22.12 이상에서 `npx -y korean-parenting-mcp@latest`로 실행하면 최신 버전으로 실행돼요.
- `.mcpb`: [릴리스 페이지](https://github.com/ok0/korean-parenting-mcp/releases)에서 최신 `.mcpb` 파일을 다시 내려받아 설치해요.

## 취약점 신고

취약점은 GitHub 비공개 취약점 신고로 알려 주세요. 저장소의 Security 탭에서 "Report a vulnerability"를 누르거나 [비공개 취약점 신고 양식](https://github.com/ok0/korean-parenting-mcp/security/advisories/new)을 열면 돼요.

신고에는 다음 내용을 적어 주세요.

- 사용한 버전(npm 버전 또는 `.mcpb` 릴리스)
- 실행 방식(`npx`, `.mcpb`, 체험 페이지 등)
- 재현 절차
- 예상되는 영향

취약점 내용은 이 비공개 신고 창구로만 보내 주세요. 공개 이슈와 PR은 일반 버그와 제안에 써 주세요.

신고를 확인하면 비공개 보안 권고(security advisory)에서 신고하신 분과 함께 내용을 살피고 고쳐요. 수정 버전을 게시한 뒤 보안 권고를 공개해요.

## API 키 다루기

일부 도구는 공공기관이 발급한 API 키를 써요. 키는 환경 변수로만 전달해 주세요. 자세한 방법은 [키 다루기](docs/advanced.md#키-다루기)에 있어요.

- 신고·이슈·PR·로그에 키를 적어야 하면 앞 몇 글자만 남긴 가린 값(예: `abcd****`)으로 적어 주세요.
- 키가 노출되었다면 그 키를 발급한 기관(발급처)에서 바로 재발급해 새 키로 바꿔 주세요.

## 신고 범위

이 정책은 다음 대상에 적용해요.

- 이 저장소의 코드
- npm 패키지 `korean-parenting-mcp`
- `.mcpb` 릴리스 파일
- GitHub Pages 체험 페이지

공공기관 API 자체의 문제(응답 오류, 데이터 내용, 키 발급 등)는 해당 API를 제공하는 기관의 창구로 문의해 주세요.
