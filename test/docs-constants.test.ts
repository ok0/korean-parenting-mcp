import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CLIENT_PAGES,
  DOCS_BLOB,
  DOC_NOTICE,
  DESKTOP_APP_NAME,
  DOC_PAGES,
  MCPB_ASSET,
  MCPB_TAG,
  MCPB_URL,
  REPO_BLOB_PATH,
  REPO_URL,
  RUN,
  SERVER_NAME,
  STATUS_BADGE,
  STATUS_LEGEND,
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

  it("DOC_PAGES order, titles, summaries, parents (ADR-51)", () => {
    expect(DOC_PAGES.map((p) => [p.id, p.path, p.title, p.summary, p.parent ?? null, p.required])).toEqual([
      ["start", "docs/start.md", "처음이라면: 쉬운 시작 안내", "무엇을 하는 도구인지, 어떻게 설치하는지 차근차근 알려 드려요", null, true],
      ["keyless", "docs/keyless.md", "키 없이 바로 쓰는 기능", "출산 예정일이나 아이 생일만 말하면 접종·검진·휴가 일정을 정리해 줘요", null, true],
      ["install", "docs/install.md", "설치 방법 고르기", "내 상황에 맞는 설치 방법 하나만 골라요", null, true],
      ["mcpb", "docs/mcpb.md", "Claude 데스크톱 앱에 설치하기(파일 하나로)", "터미널 없이 파일 하나를 내려받아 열면 돼요", "install", true],
      ["setup-wizard", "docs/setup-wizard.md", "설정 마법사로 설치하기", "명령 한 줄로 키 입력과 앱 등록을 한 번에 해요", "install", true],
      ["clients", "docs/clients/README.md", "직접 설정하기(AI 앱별)", "쓰는 AI 앱의 설정에 서버를 직접 추가해요", "install", false],
      ["advanced", "docs/advanced.md", "API 키로 기능 더하기(선택)", "야간 진료기관·리콜 조회처럼 키가 필요한 기능과 키 발급 방법", null, true],
      ["index", "docs/README.md", "전체 문서 목차", "모든 안내 문서 목록", null, false],
    ]);
    const ids = DOC_PAGES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of DOC_PAGES) {
      expect(p.path).toMatch(/^docs\/.+\.md$/);
      if (p.parent !== undefined) {
        expect(ids).toContain(p.parent);
      }
      expect(/mcpb/i.test(p.title + p.summary)).toBe(false);
    }
    expect(DOC_PAGES.filter((p) => p.required).map((p) => p.id).sort()).toEqual([
      "advanced",
      "install",
      "keyless",
      "mcpb",
      "setup-wizard",
      "start",
    ]);
  });

  it("desktop app name and status badges (ADR-51)", () => {
    expect(DESKTOP_APP_NAME).toBe("Claude 데스크톱 앱");
    expect(STATUS_BADGE).toEqual({ verified: "✅ 확인됨", pending: "⏳ 키 승인 대기", link: "🔗 링크 안내" });
    expect(STATUS_LEGEND).toBe(
      "✅ 확인됨: 실제 API 호출로 동작 확인 · ⏳ 키 승인 대기: 키 승인 전이라 실제 호출 미확인 · 🔗 링크 안내: 데이터를 조회하지 않고 공식 페이지 링크를 알려 줌",
    );
    for (const badge of Object.values(STATUS_BADGE)) {
      expect(STATUS_LEGEND).toContain(badge);
    }
    expect(STATUS_LEGEND).not.toContain("\n");
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
    expect(byId("claude-desktop")?.name).toBe(DESKTOP_APP_NAME);
    for (const p of CLIENT_PAGES) expect(p.required, p.id).toBe(p.id !== "others");
    expect(byId("others")).toEqual({ id: "others", path: "docs/clients/others.md", name: "그 밖의 AI 앱", format: "json", wrapper: null, typeField: "forbidden", required: false });
  });
});
