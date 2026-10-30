import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CLIENT_PAGES,
  DOCS_BLOB,
  DOC_NOTICE,
  DOC_PAGES,
  MCPB_ASSET,
  MCPB_TAG,
  MCPB_URL,
  REPO_BLOB_PATH,
  REPO_URL,
  RUN,
  SERVER_NAME,
  docUrl,
} from "../scripts/docs/links.js";
import { BRANCH, RAW_ASSET_PREFIX, REPO } from "../scripts/visuals/readme-figures.js";
import { OFFICIAL_CLAIM_META, OFFICIAL_CLAIM_OUTPUT, matchedPatterns } from "./helpers/wording.js";
import { SERVER_NAME as SETUP_SERVER_KEY } from "../src/setup/targets.js";

const LINKS_SOURCE = fileURLToPath(new URL("../scripts/docs/links.ts", import.meta.url));

describe("docs link constants (M34)", () => {
  it("SERVER_NAME has no underscore and fits the prefixed tool-name limit", () => {
    expect(SERVER_NAME).toBe("korean-parenting");
    expect(SERVER_NAME.includes("_")).toBe(false);
    expect(SERVER_NAME).toMatch(/^[A-Za-z0-9-]+$/);
    expect(("mcp_" + SERVER_NAME + "_find_vaccination_clinic").length).toBeLessThanOrEqual(63);
  });

  it("docs server key equals the setup wizard key", () => {
    expect(SERVER_NAME).toBe(SETUP_SERVER_KEY);
  });

  it("RUN is npx -y korean-parenting-mcp", () => {
    expect(RUN.command).toBe("npx");
    expect([...RUN.args]).toEqual(["-y", "korean-parenting-mcp"]);
  });

  it("repo, blob and mcpb URLs are assembled from readme-figures", () => {
    expect(REPO_URL).toBe("https://github.com/" + REPO);
    expect(DOCS_BLOB).toBe(REPO_URL + "/blob/" + BRANCH + "/");
    expect(REPO_BLOB_PATH).toBe("/" + REPO + "/blob/" + BRANCH + "/");
    expect(MCPB_URL).toBe(REPO_URL + "/releases/download/" + MCPB_TAG + "/" + MCPB_ASSET);
    expect(MCPB_TAG).toBe("mcpb-latest");
    expect(MCPB_ASSET).toBe("korean-parenting-mcp.mcpb");
    expect(docUrl("docs/x.md")).toBe(DOCS_BLOB + "docs/x.md");
    expect(RAW_ASSET_PREFIX).toBe("https://raw.githubusercontent.com/ok0/korean-parenting-mcp/main/assets/");
    expect(BRANCH).toBe("main");
  });

  it("links.ts is pure and defines no duplicate repo literals", () => {
    const src = readFileSync(LINKS_SOURCE, "utf8");
    expect(src).not.toMatch(/\bfrom\s+["'](node:|[^"']*\/src\/)/);
    const specifiers = [...src.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1]);
    expect(specifiers).toEqual(["../visuals/readme-figures.js"]);
    expect(src).not.toContain("ok0");
    expect(src).not.toContain("raw.githubusercontent");
    expect(src).not.toContain("/blob/main");
  });

  it("DOC_PAGES order, paths and required set", () => {
    expect(DOC_PAGES.map((p) => p.title)).toEqual([
      "키 없이 쓰는 기능",
      "설치와 실행",
      "AI 앱별 연결 방법",
      "데스크톱 앱 확장(.mcpb)",
      "설정 마법사",
      "선택·고급 기능(API 키)",
      "전체 문서 목차",
    ]);
    for (const p of DOC_PAGES) {
      expect(p.path).toMatch(/^docs\/.+\.md$/);
    }
    const ids = DOC_PAGES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(DOC_PAGES.filter((p) => p.required).map((p) => p.id).sort()).toEqual([
      "advanced",
      "install",
      "keyless",
      "mcpb",
      "setup-wizard",
    ]);
  });

  it("DOC_NOTICE wording", () => {
    for (const word of ["비공식", "의료", "법률", "관할 기관"]) {
      expect(DOC_NOTICE).toContain(word);
    }
    expect(matchedPatterns(DOC_NOTICE, OFFICIAL_CLAIM_OUTPUT)).toEqual([]);
    expect(matchedPatterns(DOC_NOTICE, OFFICIAL_CLAIM_META)).toEqual([]);
  });

  it("CLIENT_PAGES required seven", () => {
    const requiredIds = CLIENT_PAGES.filter((p) => p.required).map((p) => p.id).sort();
    expect(requiredIds).toEqual(["antigravity", "claude-code", "claude-desktop", "codex", "cursor", "gemini", "vscode"]);
    const ids = CLIENT_PAGES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of CLIENT_PAGES) {
      expect(p.path).toBe("docs/clients/" + p.id + ".md");
    }
    const byId = (id: string) => CLIENT_PAGES.find((p) => p.id === id);
    const vscode = byId("vscode");
    expect(vscode?.format).toBe("json");
    expect(vscode?.wrapper).toBe("servers");
    expect(vscode?.typeField).toBe("stdio");
    expect(byId("antigravity")?.typeField).toBe("forbidden");
    const codex = byId("codex");
    expect(codex?.format).toBe("toml");
    expect(codex?.wrapper).toBe("mcp_servers");
    const claudeCode = byId("claude-code");
    expect(claudeCode?.format).toBe("cli");
    expect(claudeCode?.wrapper).toBeNull();
  });
});
