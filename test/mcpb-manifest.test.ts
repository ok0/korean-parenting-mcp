import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { KEY_ENV, type KeyName } from "../src/core/config.js";
import { KEY_GUIDE } from "../src/core/errors.js";
import { VERSION } from "../src/version.js";
import { REFERENCE_NOTICE, SOURCE_NOTICE } from "../src/core/notice.js";
import { allTools } from "../src/tools/registry.js";
import { DEFAULT_OUT_DIR, ENTRY_REL, resolveMcpbPaths, withoutKeyEnv } from "../scripts/lib/mcpb.js";
import { McpbManifestSchema } from "@anthropic-ai/mcpb/schemas/0.3";

const NEG = /비공식|unofficial|관계없는|개인 프로젝트|(공식|공공기관|정부)[^.\n]{0,20}(아니에요|아닙니다|아니며|아니고|아님)/i;
const DESCRIPTION_PREFIX = "한국 임신·출산·육아 일정과 공공 정보를 안내하는 MCP 서버입니다.";
const EXPECTED_DESCRIPTION = `${DESCRIPTION_PREFIX} ${SOURCE_NOTICE} ${REFERENCE_NOTICE}`;
// Length limit source (M53 R4): @anthropic-ai/mcpb 2.1.2 sets none for `description`
// (dist/schemas/0.3.js:91 `z.string()`, dist/mcpb-manifest-v0.3.schema.json `{"type":"string"}`).
// DESCRIPTION_MAX_CHARS is a project guard, not an external limit.
const DESCRIPTION_MAX_CHARS = 200;
const NEGATIVE_STEM = /아니|아닌|아님|아닙/;

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (rel: string): string => readFileSync(join(root, rel), "utf8");

interface PackageJson {
  name: string;
  version: string;
  author: string;
  engines: Record<string, string>;
  scripts?: Record<string, string>;
}

interface UserConfigItem {
  type: string;
  title: string;
  description: string;
  sensitive: boolean;
  required: boolean;
  default?: unknown;
}

interface Manifest {
  manifest_version: string;
  name: string;
  display_name: string;
  version: string;
  description: string;
  long_description?: string;
  author: { name: string };
  license: string;
  server: {
    type: string;
    entry_point: string;
    mcp_config: { command: string; args: string[]; env: Record<string, string> };
  };
  user_config: Record<string, UserConfigItem>;
  compatibility: { platforms: string[]; runtimes: Record<string, string> };
  tools?: { name: string }[];
}

const pkg = JSON.parse(read("package.json")) as PackageJson;
const manifest = JSON.parse(read("manifest.json")) as Manifest;
const gitignoreLines = new Set(read(".gitignore").split("\n").map((l) => l.trim()));
const mcpbignoreLines = new Set(read(".mcpbignore").split("\n").map((l) => l.trim()));
const brokenFixture = JSON.parse(read("test/fixtures/mcpb/manifest-broken.json")) as Record<string, unknown>;

function leaves(value: unknown, out: string[]): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) leaves(v, out);
  else if (value && typeof value === "object") for (const v of Object.values(value)) leaves(v, out);
  return out;
}

function hasKey(value: unknown, key: string): boolean {
  if (Array.isArray(value)) return value.some((v) => hasKey(v, key));
  if (value && typeof value === "object") {
    return Object.keys(value).includes(key) || Object.values(value).some((v) => hasKey(v, key));
  }
  return false;
}

describe("mcpb manifest", () => {
  it("version and identity", () => {
    expect(manifest.manifest_version).toBe("0.3");
    expect(manifest.name).toBe(pkg.name);
    expect(manifest.version).toBe(pkg.version);
    expect(manifest.version).toBe(VERSION);
    expect(manifest.license).toBe("MIT");
    expect(manifest.author.name).toBe(pkg.author);
  });

  it("node server entry", () => {
    const entry = manifest.server.entry_point;
    expect(manifest.server.type).toBe("node");
    expect(typeof entry).toBe("string");
    expect(entry.startsWith("/")).toBe(false);
    expect(entry.includes("..")).toBe(false);
    expect(entry.endsWith(".map")).toBe(false);
    expect(manifest.server.mcp_config.command).toBe("node");
    expect(manifest.server.mcp_config.args).toEqual([`${"$"}{__dirname}/${entry}`]);
  });

  it("user_config mirrors KEY_ENV", () => {
    const envNames = Object.values(KEY_ENV);
    expect(envNames).toHaveLength(4);
    expect(Object.keys(manifest.user_config).sort()).toEqual([...envNames].sort());
    for (const k of Object.keys(KEY_ENV) as KeyName[]) {
      const n = KEY_ENV[k];
      const item = manifest.user_config[n];
      expect(item, n).toBeDefined();
      if (!item) continue;
      expect(item.type).toBe("string");
      expect(item.sensitive).toBe(true);
      expect(item.required).toBe(false);
      expect("default" in item).toBe(false);
      expect(item.title).toBe(KEY_GUIDE[k].title);
      expect(item.description).toContain("비워 둬도 키 없이 동작하는 기능이 있습니다");
      expect(item.description).toContain(new URL(KEY_GUIDE[k].url).hostname.replace(/^www\./, ""));
    }
  });

  it("env maps every key to user_config and nothing else", () => {
    const envNames = Object.values(KEY_ENV);
    const env = manifest.server.mcp_config.env;
    expect(Object.keys(env).sort()).toEqual([...envNames].sort());
    for (const n of envNames) {
      expect(env[n]).toBe(`${"$"}{user_config.${n}}`);
    }
  });

  it("compatibility", () => {
    expect(manifest.compatibility.runtimes.node).toBe(pkg.engines.node);
    expect([...manifest.compatibility.platforms].sort()).toEqual(["darwin", "win32"]);
  });

  it("tools, if declared, match registry", () => {
    if (manifest.tools === undefined) return;
    expect(manifest.tools.map((t) => t.name).sort()).toEqual(allTools.map((t) => t.name).sort());
  });

  it("not presented as official", () => {
    expect(manifest.display_name).toBe("한국 육아 일정 도우미");
    expect(manifest.description).toBe(EXPECTED_DESCRIPTION);
    expect(manifest.description).toContain(SOURCE_NOTICE);
    expect(manifest.description).toContain(REFERENCE_NOTICE);
    const texts = [manifest.display_name, manifest.description];
    if (manifest.long_description !== undefined) texts.push(manifest.long_description);
    for (const s of texts) {
      expect(s).not.toMatch(NEG);
      expect(s).not.toMatch(NEGATIVE_STEM);
      expect(s).not.toMatch(/(?<!비)공식\s*(서비스|앱|도구|서버|MCP)/);
      expect(s).not.toMatch(/정부\s*(제공|공식)/);
    }
  });

  it("description length accepted by mcpb (M53 R4)", () => {
    const schema = JSON.parse(read("node_modules/@anthropic-ai/mcpb/dist/mcpb-manifest-v0.3.schema.json")) as { properties: { description: Record<string, unknown> } };
    expect(schema.properties.description).toEqual({ type: "string" });
    expect(McpbManifestSchema.safeParse(manifest).success).toBe(true);
    expect(manifest.description.length).toBe(167);
    expect(manifest.description.length).toBeLessThanOrEqual(DESCRIPTION_MAX_CHARS);
  });

  it("no key-like values", () => {
    for (const s of leaves(manifest, [])) {
      const tokens = s.replace(/\$\{[^}]*\}/g, "").match(/[A-Za-z0-9+\/=%_-]{16,}/g) ?? [];
      for (const t of tokens) {
        const mixed = /[0-9]/.test(t) && /[A-Za-z]/.test(t);
        expect(mixed, t).toBe(false);
      }
    }
    expect(hasKey(manifest.user_config, "default")).toBe(false);
  });

  it(".mcpbignore excludes dev-only paths", () => {
    for (const p of ["node_modules/", "test/", "fixtures/", "scripts/", ".docs/", ".ensemble/", ".github/", "*.map", "*.bak", "*.key.txt", "Dockerfile", ".dockerignore", "deploy/", "build/remote/"]) {
      expect(mcpbignoreLines.has(p), p).toBe(true);
    }
  });

  it(".gitignore ignores mcpb output", () => {
    expect(gitignoreLines.has("build-mcpb/")).toBe(true);
    expect(gitignoreLines.has("*.mcpb")).toBe(true);
  });

  it("broken fixture lacks required fields", () => {
    expect("name" in brokenFixture).toBe(false);
    expect("server" in brokenFixture).toBe(false);
    expect(brokenFixture.manifest_version).toBe("0.3");
    expect(JSON.stringify(brokenFixture)).not.toMatch(NEG);
    expect(brokenFixture.description).toBe(EXPECTED_DESCRIPTION);
    expect(JSON.stringify(brokenFixture)).not.toMatch(NEGATIVE_STEM);
    expect(McpbManifestSchema.safeParse(brokenFixture).success).toBe(false);
  });

  it("bundle entry matches build script", () => {
    expect(manifest.server.entry_point).toBe(ENTRY_REL);
    expect(gitignoreLines.has(`${DEFAULT_OUT_DIR}/`)).toBe(true);
  });

  it("pack:mcpb script exists", () => {
    expect(pkg.scripts?.["pack:mcpb"]).toContain("build-mcpb.js");
  });

  it("resolveMcpbPaths defaults and overrides", () => {
    const defaults = resolveMcpbPaths("/r", {});
    expect(defaults.manifest).toBe(resolve("/r", "manifest.json"));
    expect(defaults.output).toBe(resolve("/r", "build-mcpb", "korean-parenting-mcp.mcpb"));
    const overridden = resolveMcpbPaths("/r", { KPM_MCPB_OUT_DIR: "/tmp/x" });
    expect(overridden.output).toBe(join("/tmp/x", "korean-parenting-mcp.mcpb"));
    expect(overridden.stage).toBe(join("/tmp/x", "stage"));
  });

  it("withoutKeyEnv strips key variables", () => {
    const env: Record<string, string> = { PATH: "p" };
    for (const name of Object.values(KEY_ENV)) env[name] = "fake";
    expect(Object.keys(withoutKeyEnv(env))).toEqual(["PATH"]);
  });
});
