import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { describe, expect, it } from "vitest";
import { KEY_ENV } from "../src/core/config.js";
import { listDocMarkdown } from "../scripts/docs/files.js";
import { RUN, SERVER_NAME } from "../scripts/docs/links.js";
import {
  BUTTON_FALLBACK,
  CURSOR_BUTTON,
  CURSOR_INSTALL,
  VSCODE_BUTTON,
  VSCODE_REDIRECT,
  cursorInstallUrl,
  cursorInstallUrlFor,
  decodeCursorInstall,
  decodeVscodeInstall,
  vscodeInstallUrl,
  vscodeInstallUrlFor,
} from "../scripts/docs/install-links.js";
import { findLeaks } from "../scripts/lib/sample-mask.js";
import { extractLinks } from "./helpers/markdown.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (rel: string): string => readFileSync(join(root, rel), "utf8");

const ALLOWED_KEYS: Record<"vscode" | "cursor", readonly string[]> = {
  vscode: ["name", "type", "command", "args"],
  cursor: ["command", "args"],
};
const KEY_NAMES: readonly string[] = Object.values(KEY_ENV);

function installProblems(app: "vscode" | "cursor", name: unknown, config: unknown): string[] {
  const problems: string[] = [];
  if (name !== SERVER_NAME) problems.push("name");
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    return [...problems, "config"];
  }
  const c = config as Record<string, unknown>;
  if (c.command !== RUN.command) problems.push("command");
  if (!isDeepStrictEqual(c.args, [...RUN.args])) problems.push("args");
  if ("env" in c) problems.push("env");
  for (const k of Object.keys(c)) {
    if (!ALLOWED_KEYS[app].includes(k)) problems.push(`key:${k}`);
  }
  if (app === "vscode" && c.type !== "stdio") problems.push("type");
  const text = JSON.stringify(config);
  for (const key of KEY_NAMES) {
    if (text.includes(key)) problems.push(`keyname:${key}`);
  }
  for (const leak of findLeaks(text, [], { heuristic: true })) problems.push(`leak:${leak}`);
  return problems;
}

function vscodeProblemsOf(config: Record<string, unknown>): string[] {
  const d = decodeVscodeInstall(vscodeInstallUrlFor(config)) as Record<string, unknown>;
  return installProblems("vscode", d.name, d);
}

function cursorProblemsOf(name: string, config: Record<string, unknown>): string[] {
  const c = decodeCursorInstall(cursorInstallUrlFor(name, config));
  return installProblems("cursor", c.name, c.config);
}

const VSCODE_BASE = { name: SERVER_NAME, type: "stdio", command: RUN.command, args: [...RUN.args] };
const CURSOR_BASE = { command: RUN.command, args: [...RUN.args] };

describe("one-click install links", () => {
  it("generated links decode to SERVER_NAME and RUN without keys (AC1)", () => {
    const d = decodeVscodeInstall(vscodeInstallUrl()) as Record<string, unknown>;
    expect(installProblems("vscode", d.name, d)).toEqual([]);
    const c = decodeCursorInstall(cursorInstallUrl());
    expect(installProblems("cursor", c.name, c.config)).toEqual([]);
    expect(vscodeInstallUrl().startsWith("https://")).toBe(true);
    expect(cursorInstallUrl().startsWith("https://")).toBe(true);
    expect(findLeaks(vscodeInstallUrl(), [], { heuristic: true })).toEqual([]);
    expect(findLeaks(cursorInstallUrl(), [], { heuristic: true })).toEqual([]);
    expect(vscodeInstallUrl()).not.toMatch(/korean_parenting/);
    expect(cursorInstallUrl()).not.toMatch(/korean_parenting/);
  });

  it("synthetic violations fail (AC1)", () => {
    expect(vscodeProblemsOf({ ...VSCODE_BASE, name: "korean_parenting" })).not.toEqual([]);
    expect(vscodeProblemsOf({ ...VSCODE_BASE, command: "node" })).not.toEqual([]);
    expect(vscodeProblemsOf({ ...VSCODE_BASE, env: { DATA_GO_KR_SERVICE_KEY: "<발급받은 키>" } })).not.toEqual([]);
    expect(cursorProblemsOf("korean_parenting", { ...CURSOR_BASE })).not.toEqual([]);
    expect(cursorProblemsOf(SERVER_NAME, { ...CURSOR_BASE, args: ["-y", "other-pkg"] })).not.toEqual([]);
    expect(cursorProblemsOf(SERVER_NAME, { ...CURSOR_BASE, env: { LAW_OC: "abc" } })).not.toEqual([]);
    expect(() => decodeVscodeInstall("https://example.com/?url=x")).toThrow("VS Code 설치 링크 형식이어야 해요");
    expect(() => decodeCursorInstall("https://example.com/?name=x&config=e30=")).toThrow("Cursor 설치 링크 형식이어야 해요");
  });

  it("buttons only in vscode.md and cursor.md, matching the generator (AC2)", () => {
    const vs = read("docs/clients/vscode.md");
    const vl = vs.split("\n");
    expect(vl.filter((l) => l === VSCODE_BUTTON)).toHaveLength(1);
    const vi = vl.indexOf(VSCODE_BUTTON);
    expect(vi).toBeLessThan(vl.indexOf("## 설정 위치"));
    expect(vl.slice(vi + 1).find((l) => l.trim() !== "")).toBe(BUTTON_FALLBACK);
    expect(extractLinks(vs).filter((l) => l.url.startsWith(VSCODE_REDIRECT)).map((l) => l.url)).toEqual([vscodeInstallUrl()]);
    expect(vs).toContain("## 설정 예시(키 없이)");
    expect(vs).toContain("--add-mcp");
    expect(vs).not.toContain(CURSOR_INSTALL);

    const cu = read("docs/clients/cursor.md");
    const cl = cu.split("\n");
    expect(cl.filter((l) => l === CURSOR_BUTTON)).toHaveLength(1);
    const ci = cl.indexOf(CURSOR_BUTTON);
    expect(ci).toBeLessThan(cl.indexOf("## 설정 위치"));
    expect(cl.slice(ci + 1).find((l) => l.trim() !== "")).toBe(BUTTON_FALLBACK);
    expect(extractLinks(cu).filter((l) => l.url.startsWith(CURSOR_INSTALL)).map((l) => l.url)).toEqual([cursorInstallUrl()]);
    expect(cu).toContain("## 설정 예시(키 없이)");
    expect(cu).not.toContain(VSCODE_REDIRECT);

    const others = [...listDocMarkdown(root), "README.md"].filter(
      (rel) => rel !== "docs/clients/vscode.md" && rel !== "docs/clients/cursor.md",
    );
    for (const rel of others) {
      const text = read(rel);
      expect(text, rel).not.toContain("insiders.vscode.dev");
      expect(text, rel).not.toContain("install-mcp");
      expect(text, rel).not.toContain("vscode:mcp");
      expect(text, rel).not.toContain("cursor://");
      expect(text, rel).not.toContain(BUTTON_FALLBACK);
    }
  });

  it("docs do not claim the button was tried (R14)", () => {
    const pattern = /설치 창이 열려요|설치 창이 열립니다|눌러 보니|눌러 봤/;
    expect(read("docs/clients/vscode.md")).not.toMatch(pattern);
    expect(read("docs/clients/cursor.md")).not.toMatch(pattern);
  });
});
