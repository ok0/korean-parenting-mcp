import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { KEY_ENV } from "../../src/core/config.js";

export const ENTRY_REL = "server/index.mjs";
export const DEFAULT_OUT_DIR = "build-mcpb";
export const STAGE_SUBDIR = "stage";
export const OUTPUT_FILE = "korean-parenting-mcp.mcpb";
export const ESM_REQUIRE_BANNER =
  'import { createRequire as __kpmCreateRequire } from "node:module";\nconst require = __kpmCreateRequire(import.meta.url);';

export interface McpbPaths {
  manifest: string;
  outDir: string;
  stage: string;
  output: string;
}

export function resolveMcpbPaths(root: string, env: Record<string, string | undefined>): McpbPaths {
  const manifest = resolve(root, env.KPM_MCPB_MANIFEST?.trim() || "manifest.json");
  const outDir = resolve(root, env.KPM_MCPB_OUT_DIR?.trim() || DEFAULT_OUT_DIR);
  return { manifest, outDir, stage: join(outDir, STAGE_SUBDIR), output: join(outDir, OUTPUT_FILE) };
}

export function mcpbCliPath(root: string): string {
  const pkgDir = join(root, "node_modules", "@anthropic-ai", "mcpb");
  const pkgJson = join(pkgDir, "package.json");
  if (!existsSync(pkgJson)) {
    throw new Error("@anthropic-ai/mcpb CLI를 찾을 수 없습니다: npm ci 먼저 실행");
  }
  const pkg = JSON.parse(readFileSync(pkgJson, "utf8")) as { bin?: string | Record<string, string> };
  const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.mcpb;
  if (!bin) {
    throw new Error("@anthropic-ai/mcpb CLI를 찾을 수 없습니다: npm ci 먼저 실행");
  }
  return resolve(pkgDir, bin);
}

export function withoutKeyEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const copy: NodeJS.ProcessEnv = { ...env };
  for (const name of Object.values(KEY_ENV)) delete copy[name];
  return copy;
}
