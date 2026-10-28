import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import {
  ENTRY_REL,
  ESM_REQUIRE_BANNER,
  mcpbCliPath,
  resolveMcpbPaths,
  withoutKeyEnv,
} from "./lib/mcpb.js";

const root = fileURLToPath(new URL("../../", import.meta.url));

function runMcpb(cli: string, args: string[], env: NodeJS.ProcessEnv): number | null {
  return spawnSync(process.execPath, [cli, ...args], {
    stdio: ["ignore", "inherit", "inherit"],
    env,
  }).status;
}

async function main(): Promise<void> {
  const paths = resolveMcpbPaths(root, process.env);
  if (!existsSync(join(root, "build/index.js"))) {
    throw new Error("build/index.js 없음: npm run build 먼저 실행");
  }
  rmSync(paths.stage, { recursive: true, force: true });
  rmSync(paths.output, { force: true });
  mkdirSync(dirname(join(paths.stage, ENTRY_REL)), { recursive: true });

  await build({
    entryPoints: [join(root, "build/index.js")],
    outfile: join(paths.stage, ENTRY_REL),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    sourcemap: false,
    minify: false,
    banner: { js: ESM_REQUIRE_BANNER },
    logLevel: "warning",
  });

  cpSync(join(root, "data"), join(paths.stage, "data"), { recursive: true });
  copyFileSync(paths.manifest, join(paths.stage, "manifest.json"));
  copyFileSync(join(root, ".mcpbignore"), join(paths.stage, ".mcpbignore"));

  const cli = mcpbCliPath(root);
  const env = withoutKeyEnv(process.env);
  if (runMcpb(cli, ["validate", join(paths.stage, "manifest.json")], env) !== 0) {
    throw new Error("manifest 검증 실패");
  }
  const packStatus = runMcpb(cli, ["pack", paths.stage, paths.output], env);
  if (packStatus !== 0 || !existsSync(paths.output)) {
    throw new Error("mcpb pack 실패");
  }
  process.stdout.write(`MCPB PACK PASS (${relative(root, paths.output)})\n`);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`MCPB PACK FAIL: ${message}\n`);
  process.exitCode = 1;
});
