import { readdirSync, readFileSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listDocMarkdown } from "../scripts/docs/files.js";
import {
  CHATGPT_UNSUPPORTED_LINE,
  REMOTE_PROMISE_PATTERNS,
  publicPackageText,
  remotePromiseProblems,
  type TextKind,
} from "./helpers/remote-wording.js";
import { matchedPatterns } from "./helpers/wording.js";

const root = fileURLToPath(new URL("../", import.meta.url));

interface Target {
  file: string;
  text: string;
  kind: TextKind;
}

function targets(): Target[] {
  const out: Target[] = [];
  const read = (rel: string): string => readFileSync(join(root, rel), "utf8");
  out.push({ file: "README.md", text: read("README.md"), kind: "markdown" });
  for (const rel of listDocMarkdown(root)) out.push({ file: rel, text: read(rel), kind: "markdown" });
  for (const rel of readdirSync(join(root, "site"), { recursive: true })) {
    const name = String(rel);
    if (![".html", ".css", ".ts"].includes(extname(name))) continue;
    out.push({ file: `site/${name}`, text: read(`site/${name}`), kind: "plain" });
  }
  for (const rel of readdirSync(join(root, "assets"))) {
    if (extname(rel) !== ".svg") continue;
    out.push({ file: `assets/${rel}`, text: read(`assets/${rel}`), kind: "plain" });
  }
  out.push({ file: "manifest.json", text: read("manifest.json"), kind: "plain" });
  const pkg = JSON.parse(read("package.json")) as Record<string, unknown>;
  out.push({ file: "package.json", text: publicPackageText(pkg), kind: "plain" });
  return out;
}

describe("no remote promises in public artifacts (M40, PAC38)", () => {
  it("public artifacts contain no remote promise (R3, AC3)", () => {
    const all = targets();
    const problems = all.flatMap((t) => remotePromiseProblems(t.file, t.text, t.kind));
    expect(problems).toEqual([]);

    const labels = all.map((t) => t.file);
    expect(all.filter((t) => t.kind === "markdown").length).toBeGreaterThanOrEqual(17);
    expect(labels.filter((f) => f.startsWith("site/")).length).toBeGreaterThanOrEqual(6);
    expect(labels.filter((f) => f.startsWith("assets/") && f.endsWith(".svg")).length).toBe(8);
    expect(labels).toEqual(expect.arrayContaining(["README.md", "manifest.json", "package.json"]));
  });

  it("every pattern catches its synthetic sample (R4, AC3)", () => {
    const SAMPLES: readonly string[] = [
      "커넥터: https://kpm-abc.a.run.app/mcp",
      "https://kpm.fly.dev/mcp 로 연결",
      "원격으로도 쓸 수 있어요",
      "Remote MCP server",
      "곧 제공돼요",
      "서버를 제공한 뒤 알려 드릴게요",
      "자세한 건 M26에서",
      "[비교](remote.md)",
      "커넥터 URL을 추가하세요",
      "[처리방침](https://example.com/privacy)",
    ];
    expect(SAMPLES.length).toBe(REMOTE_PROMISE_PATTERNS.length);
    SAMPLES.forEach((sample, i) => {
      expect(matchedPatterns(sample, REMOTE_PROMISE_PATTERNS)).toContain(REMOTE_PROMISE_PATTERNS[i]!.source);
      expect(remotePromiseProblems("sample.md", sample, "markdown")).not.toEqual([]);
    });
  });

  it("ChatGPT may only be called unsupported (R4, AC3)", () => {
    for (const ok of [CHATGPT_UNSUPPORTED_LINE, "ChatGPT는 현재 미지원이에요.", "자세히: <https://learn.chatgpt.com/x>"]) {
      expect(remotePromiseProblems("x.md", ok, "markdown")).toEqual([]);
    }
    const bad: [string, TextKind][] = [
      ["ChatGPT에서도 써요.", "markdown"],
      ["ChatGPT 지원은 곧 추가할 예정이에요.", "markdown"],
      ["ChatGPT는 현재 지원하지 않아요. 원격 모드를 제공한 뒤 안내할 예정이에요.", "markdown"],
      ["ChatGPT는 지금은 지원하지 않지만 나중에 지원할 예정이에요.", "markdown"],
      ["<text>ChatGPT 연결 준비 중</text>", "plain"],
    ];
    for (const [text, kind] of bad) {
      expect(remotePromiseProblems("x", text, kind)).not.toEqual([]);
    }
  });

  it("normal samples pass (R4)", () => {
    for (const ok of [
      "출산예정일을 넣으면 일정을 알려 드려요.",
      "내 컴퓨터에서 실행하는 로컬 서버예요.",
      '<section class="privacy">',
      "https://ok0.github.io/korean-parenting-mcp/",
    ]) {
      expect(remotePromiseProblems("x.md", ok, "markdown")).toEqual([]);
    }
  });

  it("package.json scan covers user-facing fields only (R3)", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as Record<string, unknown>;
    const text = publicPackageText(pkg);
    expect(text).toContain("description:");
    expect(text).toContain("keywords:");
    expect(text).not.toContain("build/remote");
    expect(remotePromiseProblems("package.json", publicPackageText({ ...pkg, description: "원격 지원" }), "plain")).not.toEqual([]);
  });
});
