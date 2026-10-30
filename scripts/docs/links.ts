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
export interface DocPage { readonly id: string; readonly path: string; readonly title: string; readonly required: boolean; }
export const DOC_PAGES: readonly DocPage[] = [
  { id: "keyless", path: "docs/keyless.md", title: "키 없이 쓰는 기능", required: true },
  { id: "install", path: "docs/install.md", title: "설치와 실행", required: true },
  { id: "clients", path: "docs/clients/README.md", title: "AI 앱별 연결 방법", required: false },
  { id: "mcpb", path: "docs/mcpb.md", title: "데스크톱 앱 확장(.mcpb)", required: true },
  { id: "setup-wizard", path: "docs/setup-wizard.md", title: "설정 마법사", required: true },
  { id: "advanced", path: "docs/advanced.md", title: "선택·고급 기능(API 키)", required: true },
  { id: "index", path: "docs/README.md", title: "전체 문서 목차", required: false },
];
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
