import { Buffer } from "node:buffer";
import { RUN, SERVER_NAME } from "./links.js";

/** VS Code 설치 링크 중계 주소. */
export const VSCODE_REDIRECT = "https://insiders.vscode.dev/redirect?url=";
/** Cursor 설치 링크 주소. */
export const CURSOR_INSTALL = "https://cursor.com/en/install-mcp";

/** VS Code 설치 링크를 이중 인코딩으로 만든다. */
export function vscodeInstallUrlFor(config: Record<string, unknown>): string {
  return VSCODE_REDIRECT + encodeURIComponent("vscode:mcp/install?" + encodeURIComponent(JSON.stringify(config)));
}

/** Cursor 설치 링크를 base64 설정으로 만든다. */
export function cursorInstallUrlFor(name: string, config: Record<string, unknown>): string {
  return CURSOR_INSTALL + "?name=" + encodeURIComponent(name) + "&config=" + encodeURIComponent(Buffer.from(JSON.stringify(config), "utf8").toString("base64"));
}

/** 이 프로젝트의 VS Code 설치 링크. */
export function vscodeInstallUrl(): string {
  return vscodeInstallUrlFor({ name: SERVER_NAME, type: "stdio", command: RUN.command, args: [...RUN.args] });
}

/** 이 프로젝트의 Cursor 설치 링크. */
export function cursorInstallUrl(): string {
  return cursorInstallUrlFor(SERVER_NAME, { command: RUN.command, args: [...RUN.args] });
}

/** VS Code 설치 링크를 풀어서 설정 객체를 돌려준다. */
export function decodeVscodeInstall(url: string): unknown {
  const u = new URL(url);
  if (u.origin + u.pathname !== "https://insiders.vscode.dev/redirect") throw new Error("VS Code 설치 링크 형식이어야 해요");
  const inner = u.searchParams.get("url");
  if (inner === null) throw new Error("url 값이 없어요");
  const prefix = "vscode:mcp/install?";
  if (!inner.startsWith(prefix)) throw new Error("VS Code 설치 내용 형식이어야 해요");
  return JSON.parse(decodeURIComponent(inner.slice(prefix.length)));
}

/** Cursor 설치 링크를 풀어서 이름과 설정을 돌려준다. */
export function decodeCursorInstall(url: string): { name: string | null; config: unknown } {
  const u = new URL(url);
  if (u.origin + u.pathname !== CURSOR_INSTALL) throw new Error("Cursor 설치 링크 형식이어야 해요");
  const cfg = u.searchParams.get("config");
  if (cfg === null) throw new Error("config 값이 없어요");
  return { name: u.searchParams.get("name"), config: JSON.parse(Buffer.from(cfg, "base64").toString("utf8")) };
}

/** VS Code 설치 버튼 문단. */
export const VSCODE_BUTTON = "[VS Code에 설치하기](" + vscodeInstallUrl() + ")";
/** Cursor 설치 버튼 문단. */
export const CURSOR_BUTTON = "[Cursor에 설치하기](" + cursorInstallUrl() + ")";
/** 버튼이 안 열릴 때 안내 문구. */
export const BUTTON_FALLBACK = "버튼이 열리지 않으면 아래 설정을 복사해 붙여 넣으세요.";
