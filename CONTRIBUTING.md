# 기여 안내

한국 육아 일정 도우미(`korean-parenting-mcp`)에 관심을 가져 주셔서 고맙습니다. 버그 알림, 제안, 코드와 데이터 기여를 모두 환영해요.

## 시작하기

Node.js 22.12 이상이 필요해요. 저장소를 내려받은 뒤 다음 명령을 실행해요.

```sh
npm ci
npm run verify
```

`npm run verify`는 타입 검사, 빌드, 테스트를 한 번에 실행해요.

## 이슈와 제안

버그와 제안은 [GitHub 이슈](https://github.com/ok0/korean-parenting-mcp/issues)에 남겨 주세요. 재현 절차와 기대한 결과를 함께 적어 주시면 빠르게 확인할 수 있어요. 보안 문제는 [SECURITY.md](SECURITY.md)의 안내에 따라 비공개로 알려 주세요.

## 변경 보내기

- 한 PR에는 한 가지 변경을 작게 담아 주세요.
- PR을 보내기 전에 `npm run verify`가 통과하는지 확인해 주세요.

## 커밋 메시지

커밋 메시지는 영어로, Conventional Commits 형식(`type(scope): summary`)으로 써요.

- 예: `feat(timeline): add checkup dates`
- 타입: `feat`, `fix`, `docs`, `test`, `refactor`, `build`, `ci`, `chore`

## 데이터 추가·수정

- `data/`에는 공공기관이 공개한 자료로 만든 정적 정보만 담아요.
- 항목마다 출처, 기준일(`as_of`), 검증 상태를 적어요.
- 스크립트가 만드는 파일은 `scripts/`의 해당 스크립트로 다시 생성해요.
- API 응답 원문과 키 값은 저장소 밖에 두어요. 테스트 fixture에는 가린 값(예: `abcd****`)을 써요.

## 문구 규칙

- 사용자에게 보이는 문구는 한국어 긍정형으로 써요. 예: "참고용 정보예요. 진료·처방은 의료진과 상의하세요."
- 출처는 "공공기관이 제공하는 공개 API와 자료를 이용해 …" 형태로 밝혀요.
- 소개 문구에는 "AI 도우미"처럼 여러 앱에 두루 맞는 표현을 써요. AI 앱 이름은 설치 안내에서 여러 예시 중 하나로만 적어요.
- 공개 설명서는 `docs/`에 둬요.
- `npm run verify`가 이 규칙을 자동으로 확인해요.

## 라이선스

보내 주신 기여는 이 저장소와 같은 MIT 라이선스로 배포돼요. 자세한 내용은 [LICENSE](LICENSE)를 보세요.
