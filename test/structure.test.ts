import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { VERSION } from "../src/version.js";
import { docsDirViolations } from "./helpers/root-docs.js";

const root = fileURLToPath(new URL("../", import.meta.url));

interface PackageJson {
  version: string;
  bin: Record<string, string>;
  files?: string[];
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  license?: string;
  engines?: Record<string, string>;
  keywords?: string[];
  description?: string;
  homepage?: string;
  repository?: { type?: string; url?: string };
  bugs?: { url?: string };
  mcpName?: string;
}

function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listTs(full));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

function rel(file: string): string {
  return relative(root, file).split(sep).join("/");
}

function localImports(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const re = /(?:from\s+|import\s*\(\s*|import\s+)["'](\.{1,2}\/[^"']+)["']/g;
  const out: string[] = [];
  for (const m of text.matchAll(re)) {
    out.push(rel(resolve(dirname(file), m[1] as string).replace(/\.js$/, ".ts")));
  }
  return out;
}

function reach(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const next = queue.shift() as string;
    if (seen.has(next)) continue;
    seen.add(next);
    const full = join(root, next);
    if (existsSync(full)) queue.push(...localImports(full));
  }
  return seen;
}

function runtimeSpecifiers(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const out: string[] = [];
  for (const m of text.matchAll(/(?:^|\n)[ \t]*(?:import|export)\s+([^;]*?)\s*from\s*["']([^"']+)["']/g)) {
    const clause = (m[1] as string).trim();
    if (clause.startsWith("type ")) continue;
    const braces = /^\{([\s\S]*)\}$/.exec(clause);
    if (braces) {
      const names = (braces[1] as string).split(",").map((s) => s.trim()).filter((s) => s !== "");
      if (names.length > 0 && names.every((s) => s.startsWith("type "))) continue;
    }
    out.push(m[2] as string);
  }
  for (const m of text.matchAll(/(?:^|\n)[ \t]*import\s*["']([^"']+)["']/g)) out.push(m[1] as string);
  return out;
}

function reachRuntime(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const next = queue.shift() as string;
    if (seen.has(next)) continue;
    seen.add(next);
    const full = join(root, next);
    if (!existsSync(full)) continue;
    for (const spec of runtimeSpecifiers(full)) {
      if (!spec.startsWith(".")) continue;
      queue.push(rel(resolve(dirname(full), spec).replace(/\.js$/, ".ts")));
    }
  }
  return seen;
}

const srcFiles = listTs(join(root, "src"));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as PackageJson;

describe("project structure", () => {
  it("StdioServerTransport only in entry", () => {
    const files = srcFiles
      .filter((f) => readFileSync(f, "utf8").includes("StdioServerTransport"))
      .map(rel);
    expect(files).toEqual(["src/index.ts"]);
  });

  it("SDK imports limited", () => {
    const files = srcFiles
      .filter((f) => readFileSync(f, "utf8").includes("@modelcontextprotocol/sdk"))
      .map(rel);
    const allowed = new Set(["src/index.ts", "src/server/create-server.ts", "src/remote/app.ts"]);
    for (const f of files) {
      expect(allowed.has(f)).toBe(true);
    }
  });

  it("no .env loading", () => {
    for (const f of srcFiles) {
      const text = readFileSync(f, "utf8");
      expect(text, rel(f)).not.toContain("dotenv");
      expect(text, rel(f)).not.toContain("loadEnvFile");
      expect(text, rel(f)).not.toContain('".env"');
      expect(text, rel(f)).not.toContain("'.env'");
    }
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(Object.keys(allDeps)).not.toContain("dotenv");
  });

  it("bin points to build output", () => {
    expect(pkg.bin["korean-parenting-mcp"]).toBe("build/index.js");
    const binPath = join(root, "build/index.js");
    expect(existsSync(binPath)).toBe(true);
    const firstLine = readFileSync(binPath, "utf8").split("\n")[0];
    expect(firstLine).toBe("#!/usr/bin/env node");
  });

  it("version matches package.json", () => {
    expect(VERSION).toBe(pkg.version);
  });

  it("data ships with package", () => {
    expect([...(pkg.files ?? [])].sort()).toEqual(["!build/remote", "LICENSE", "README.md", "build", "data"]);
    expect(existsSync(join(root, "data/basis-documents.json"))).toBe(true);
    expect(existsSync(join(root, "data/holidays.json"))).toBe(true);
  });

  it("no runtime annex parsing", () => {
    const readers = srcFiles
      .filter((f) => readFileSync(f, "utf8").includes("readFileSync"))
      .map(rel);
    expect(readers).toEqual(["src/data-store/load.ts"]);
    for (const f of srcFiles) {
      expect(readFileSync(f, "utf8"), rel(f)).not.toMatch(/\.(pdf|hwp|hwpx)\b/i);
    }
    const runtimeDeps = Object.keys(pkg.dependencies ?? {});
    expect(runtimeDeps.filter((d) => /pdf|hwp/i.test(d))).toEqual([]);
  });

  it("root documents limited", () => {
    const docs = readdirSync(root).filter(
      (n) =>
        /\.(md|markdown|txt|rst)$/i.test(n) ||
        /^(LICEN[CS]E|COPYING|NOTICE|CHANGELOG|AUTHORS|CONTRIBUTING)(\.|$)/i.test(n),
    );
    expect(docs.sort()).toEqual(["CONTRIBUTING.md", "LICENSE", "README.md", "SECURITY.md"]);
    expect(docsDirViolations(root)).toEqual([]);
  });

  it("package metadata for publishing", () => {
    expect(pkg.scripts?.prepublishOnly).toBe("npm run verify");
    expect(pkg.license).toBe("MIT");
    expect(pkg.engines?.node).toBe(">=22.12");
    expect(pkg.keywords?.length ?? 0).toBeGreaterThan(0);
    expect(pkg.description ?? "").toBe("한국 임신·출산·육아 정보 MCP 서버");
    expect(pkg.repository).toEqual({ type: "git", url: "git+https://github.com/ok0/korean-parenting-mcp.git" });
    expect(pkg.homepage).toBe("https://ok0.github.io/korean-parenting-mcp/");
    expect(pkg.bugs?.url).toBe("https://github.com/ok0/korean-parenting-mcp/issues");
    expect(pkg.mcpName).toBe("io.github.ok0/korean-parenting-mcp");
    expect(pkg.keywords).toEqual(expect.arrayContaining(["mcp", "mcp-server", "model-context-protocol", "ai-assistant", "korea"]));
    expect((pkg.keywords ?? []).join(" ")).not.toMatch(/claude|cursor|gemini|codex|chatgpt/i);
  });

  it("child_process only in setup", () => {
    const files = srcFiles
      .filter((f) => readFileSync(f, "utf8").includes("node:child_process"))
      .map(rel);
    for (const f of files) {
      expect(f.startsWith("src/setup/"), f).toBe(true);
    }
  });

  it("remote code is isolated", () => {
    for (const f of srcFiles) {
      const r = rel(f);
      if (r.startsWith("src/remote/")) continue;
      for (const target of localImports(f)) {
        expect(target.startsWith("src/remote/"), `${r} -> ${target}`).toBe(false);
      }
    }
  });

  it("remote entry does not load stdio-guard", () => {
    const reached = reach("src/remote/main.ts");
    expect(reached.has("src/stdio-guard.ts")).toBe(false);
    expect(reached.has("src/index.ts")).toBe(false);
    expect(reached.has("src/remote/app.ts")).toBe(true);
  });

  it("local entry does not reach remote code", () => {
    const reached = reach("src/index.ts");
    for (const f of reached) {
      expect(f.startsWith("src/remote/"), f).toBe(false);
    }
  });

  it("no hosting vendor SDKs, headers or env names in src (GCP/AWS/others)", () => {
    const banned = [
      "@aws-sdk",
      "aws-sdk",
      "lightsail",
      "fly-client-ip",
      "fly-region",
      "fly.toml",
      "cf-connecting-ip",
      "@cloudflare/",
      "x-vercel-",
      "x-amzn-",
      "x-appengine-",
      "@netlify/",
      "@google-cloud/",
      "googleapis",
      "x-goog-",
      "x-cloud-trace-context",
      "x-serverless-authorization",
      "k_service",
      "k_revision",
      "k_configuration",
      "google_cloud_project",
      "gcloud",
      "aws_region",
      "aws_lambda",
    ];
    for (const f of srcFiles) {
      const text = readFileSync(f, "utf8").toLowerCase();
      for (const b of banned) {
        expect(text.includes(b), `${rel(f)} ${b}`).toBe(false);
      }
    }
  });

  it("remote env read only in remote entry", () => {
    const files = srcFiles
      .filter((f) => rel(f).startsWith("src/remote/"))
      .filter((f) => readFileSync(f, "utf8").includes("process.env"))
      .map(rel);
    expect(files).toEqual(["src/remote/main.ts"]);
  });

  it("packaging tools are dev-only", () => {
    const tools = ["esbuild", "@anthropic-ai/mcpb"];
    for (const t of tools) {
      expect(pkg.devDependencies?.[t], t).toBeDefined();
      expect(Object.keys(pkg.dependencies ?? {}), t).not.toContain(t);
    }
    for (const f of srcFiles) {
      const text = readFileSync(f, "utf8");
      for (const t of tools) {
        expect(text.includes(t), `${rel(f)} ${t}`).toBe(false);
      }
    }
  });

  it("no file write APIs in remote and core", () => {
    for (const f of srcFiles) {
      const r = rel(f);
      if (!(r.startsWith("src/remote/") || r.startsWith("src/core/"))) continue;
      expect(/writeFile|appendFile|createWriteStream/.test(readFileSync(f, "utf8")), r).toBe(false);
    }
  });

  it("offline path reaches no node, client, http or cache modules", () => {
    const entries = [
      "src/timeline/offline.ts",
      "src/timeline/input.ts",
      "src/data-store/validate.ts",
      "src/provenance/revision-text.ts",
    ];
    const boundary = "src/data-store/load.ts";
    const banned = ["src/core/http.ts", "src/core/cache.ts", "src/tools/registry.ts"];
    for (const e of entries) {
      expect(existsSync(join(root, e)), e).toBe(true);
      for (const file of reachRuntime(e)) {
        const full = join(root, file);
        if (!existsSync(full)) continue;
        expect(/\bimport\s*\(/.test(readFileSync(full, "utf8")), `${e} -> ${file} dynamic import`).toBe(false);
        expect(file.startsWith("src/clients/"), `${e} -> ${file}`).toBe(false);
        expect(banned.includes(file), `${e} -> ${file}`).toBe(false);
        if (file !== boundary) {
          for (const spec of runtimeSpecifiers(full)) {
            expect(spec.startsWith("node:"), `${e} -> ${file} ${spec}`).toBe(false);
          }
        }
      }
    }
    for (const e of entries.slice(1)) {
      expect(reachRuntime(e).has(boundary), e).toBe(false);
    }
    expect(reachRuntime("src/timeline/offline.ts").has(boundary)).toBe(true);
    const boundarySpecs = [...new Set(runtimeSpecifiers(join(root, boundary)).filter((s) => s.startsWith(".")))];
    expect(boundarySpecs).toEqual(["./validate.js"]);
  });

  it("offline path runtime files stay within the allowlist", () => {
    const prefixes = ["src/timeline/", "src/date/"];
    const files = [
      "src/data-store/load.ts",
      "src/data-store/validate.ts",
      "src/data-store/schema.ts",
      "src/provenance/revision-text.ts",
      "src/core/tool-error.ts",
      "src/tools/shared/format.ts",
      "src/core/notice.ts",
      "src/region/normalize.ts",
      "src/region/health-centers.ts",
    ];
    const reach = reachRuntime("src/timeline/offline.ts");
    for (const f of reach) {
      expect(prefixes.some((p) => f.startsWith(p)) || files.includes(f), f).toBe(true);
    }
    for (const f of ["src/region/normalize.ts", "src/region/health-centers.ts", "src/core/notice.ts"]) {
      expect(reach.has(f), f).toBe(true);
    }
  });
});
