import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { VERSION } from "../src/version.js";

const root = fileURLToPath(new URL("../", import.meta.url));

interface PackageJson {
  version: string;
  bin: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
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
    const allowed = new Set(["src/index.ts", "src/server/create-server.ts"]);
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
});
