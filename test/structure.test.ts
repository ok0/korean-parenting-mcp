import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { VERSION } from "../src/version.js";

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
    expect(docs.sort()).toEqual(["LICENSE", "README.md"]);
    expect(existsSync(join(root, "docs"))).toBe(false);
  });

  it("package metadata for publishing", () => {
    expect(pkg.scripts?.prepublishOnly).toBe("npm run verify");
    expect(pkg.license).toBe("MIT");
    expect(pkg.engines?.node).toMatch(/^>=\d+/);
    expect(pkg.keywords?.length ?? 0).toBeGreaterThan(0);
    expect(pkg.description ?? "").toContain("비공식");
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

  it("no hosting vendor specifics in src", () => {
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
});
