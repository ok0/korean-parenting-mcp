import { BRANCH, REPO } from "../visuals/readme-figures.js";

/** 저장소 주소. */
export const REPO_URL = `https://github.com/${REPO}`;
/** 저장소 파일 보기 주소 접두사. */
export const DOCS_BLOB = `${REPO_URL}/blob/${BRANCH}/`;
/** GitHub 렌더러가 내보낼 수 있는 루트 기준 형태(미리보기 치환용). */
export const REPO_BLOB_PATH = `/${REPO}/blob/${BRANCH}/`;
export function docUrl(rel: string): string { return DOCS_BLOB + rel; }
/** 공개 문서·설정 예시의 서버 등록 키(밑줄 없음, R68). 설정 마법사(src/setup/targets.ts SERVER_NAME)와 같은 값이어야 한다 — test/docs-constants.test.ts가 대조. 실행 명령의 패키지 이름은 RUN(korean-parenting-mcp). */
export const SERVER_NAME = "korean-parenting";
export const RUN = { command: "npx", args: ["-y", "korean-parenting-mcp"] } as const;
export const MCPB_TAG = "mcpb-latest";
export const MCPB_ASSET = "korean-parenting-mcp.mcpb";
export const MCPB_URL = `${REPO_URL}/releases/download/${MCPB_TAG}/${MCPB_ASSET}`;
export const DOC_NOTICE = "이 문서는 정부·공공기관과 관계없는 비공식 개인 프로젝트의 안내입니다. 의료·법률 자문이 아니며, 건강 상태는 의료진에게, 제도·신청 기한은 관할 기관에 확인하세요.";
export interface DocPage { readonly id: string; readonly path: string; readonly title: string; readonly summary: string; readonly parent?: string; readonly required: boolean; }
export const DOC_PAGES: readonly DocPage[] = [
  { id: "start", path: "docs/start.md", title: "처음이라면: 쉬운 시작 안내", summary: "무엇을 하는 도구인지, 어떻게 설치하는지 차근차근 알려 드려요", required: true },
  { id: "keyless", path: "docs/keyless.md", title: "키 없이 바로 쓰는 기능", summary: "출산 예정일이나 아이 생일만 말하면 접종·검진·휴가 일정을 정리해 줘요", required: true },
  { id: "install", path: "docs/install.md", title: "설치 방법 고르기", summary: "내 상황에 맞는 설치 방법 하나만 골라요", required: true },
  { id: "mcpb", path: "docs/mcpb.md", title: "Claude 데스크톱 앱에 설치하기(파일 하나로)", summary: "터미널 없이 파일 하나를 내려받아 열면 돼요", parent: "install", required: true },
  { id: "setup-wizard", path: "docs/setup-wizard.md", title: "설정 마법사로 설치하기", summary: "명령 한 줄로 키 입력과 앱 등록을 한 번에 해요", parent: "install", required: true },
  { id: "clients", path: "docs/clients/README.md", title: "직접 설정하기(AI 앱별)", summary: "쓰는 AI 앱의 설정에 서버를 직접 추가해요", parent: "install", required: false },
  { id: "advanced", path: "docs/advanced.md", title: "API 키로 기능 더하기(선택)", summary: "야간 진료기관·리콜 조회처럼 키가 필요한 기능과 키 발급 방법", required: true },
  { id: "index", path: "docs/README.md", title: "전체 문서 목차", summary: "모든 안내 문서 목록", required: false },
];
export const DESKTOP_APP_NAME = "Claude 데스크톱 앱";
export const STATUS_BADGE = { verified: "✅ 확인됨", pending: "⏳ 키 승인 대기", link: "🔗 링크 안내" } as const;
export const STATUS_LEGEND = "✅ 확인됨: 실제 API 호출로 동작 확인 · ⏳ 키 승인 대기: 키 승인 전이라 실제 호출 미확인 · 🔗 링크 안내: 데이터를 조회하지 않고 공식 페이지 링크를 알려 줌";
export type ClientFormat = "json" | "toml" | "cli";
export type ClientWrapper = "servers" | "mcpServers" | "mcp_servers" | null;
export type ClientTypeField = "stdio" | "forbidden" | "any";
export interface ClientPage { readonly id: string; readonly path: string; readonly name: string; readonly format: ClientFormat; readonly wrapper: ClientWrapper; readonly typeField: ClientTypeField; readonly required: boolean; }
export const CLIENT_PAGES: readonly ClientPage[] = [
  { id: "vscode", path: "docs/clients/vscode.md", name: "VS Code", format: "json", wrapper: "servers", typeField: "stdio", required: true },
  { id: "cursor", path: "docs/clients/cursor.md", name: "Cursor", format: "json", wrapper: "mcpServers", typeField: "any", required: true },
  { id: "gemini", path: "docs/clients/gemini.md", name: "Gemini CLI·Gemini Code Assist", format: "json", wrapper: "mcpServers", typeField: "any", required: true },
  { id: "antigravity", path: "docs/clients/antigravity.md", name: "Antigravity", format: "json", wrapper: "mcpServers", typeField: "forbidden", required: true },
  { id: "codex", path: "docs/clients/codex.md", name: "Codex", format: "toml", wrapper: "mcp_servers", typeField: "any", required: true },
  { id: "claude-desktop", path: "docs/clients/claude-desktop.md", name: "Claude Desktop", format: "json", wrapper: "mcpServers", typeField: "any", required: true },
  { id: "claude-code", path: "docs/clients/claude-code.md", name: "Claude Code", format: "cli", wrapper: null, typeField: "any", required: true },
];
