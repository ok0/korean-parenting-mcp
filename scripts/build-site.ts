import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "esbuild";
import { isMainModule } from "./lib/script-io.js";

export const SITE_FORBIDDEN_TOKENS: readonly string[] = [
  "fetch(",
  "XMLHttpRequest",
  "sendBeacon",
  "WebSocket",
  "EventSource",
  "process.env",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "DATA_GO_KR_SERVICE_KEY",
  "KINDERGARTEN_API_KEY",
  "LAW_OC",
  "SAFETYKOREA_AUTH_KEY",
];

export function findRepoRoot(from: string = import.meta.url): string {
  let dir = dirname(fileURLToPath(from));
  for (let level = 0; level <= 4; level++) {
    if (existsSync(join(dir, "package.json")) && existsSync(join(dir, "site/src/main.ts"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("저장소 루트를 찾을 수 없습니다");
}

export function browserLoaderPlugin(root: string): Plugin {
  return {
    name: "browser-data-loader",
    setup(build) {
      build.onResolve({ filter: /data-store\/load\.js$/ }, () => ({
        path: join(root, "site/src/data-browser.ts"),
      }));
    },
  };
}

export function checkBundle(js: string, inputs: readonly string[]): string[] {
  const problems: string[] = [];
  for (const p of inputs) {
    if (p.startsWith("node:") || p === "src/data-store/load.ts") {
      problems.push(`node import: ${p}`);
    }
  }
  if (/["']node:[a-z]/.test(js)) {
    problems.push("node specifier in output");
  }
  for (const token of SITE_FORBIDDEN_TOKENS) {
    if (js.includes(token)) {
      problems.push(`forbidden token: ${token}`);
    }
  }
  return problems;
}

export async function buildSiteBundle(opts: {
  write: boolean;
  outdir?: string;
  root?: string;
}): Promise<{ js: string }> {
  const root = opts.root ?? findRepoRoot();
  const result = await build({
    entryPoints: [join(root, "site/src/main.ts")],
    absWorkingDir: root,
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    globalName: "KPM",
    target: "es2022",
    minify: false,
    legalComments: "none",
    charset: "utf8",
    sourcemap: false,
    metafile: true,
    logLevel: "warning",
    plugins: [browserLoaderPlugin(root)],
  });
  const js = result.outputFiles?.[0]?.text;
  if (js === undefined) {
    throw new Error("번들 출력이 없습니다");
  }
  const problems = checkBundle(js, Object.keys(result.metafile?.inputs ?? {}));
  if (problems.length > 0) {
    throw new Error("브라우저 번들 검사 실패: " + problems.join("; "));
  }
  if (opts.write) {
    const outdir = resolve(opts.outdir ?? join(root, "build-site"));
    if (resolve(root) === outdir || (resolve(root) + sep).startsWith(outdir + sep)) {
      throw new Error("출력 경로가 저장소 루트를 포함합니다: " + outdir);
    }
    rmSync(outdir, { recursive: true, force: true });
    mkdirSync(outdir, { recursive: true });
    writeFileSync(join(outdir, "app.js"), js, "utf8");
    for (const name of ["index.html", "style.css"]) {
      const src = join(root, "site", name);
      if (existsSync(src)) copyFileSync(src, join(outdir, name));
    }
    const assetsDir = join(root, "assets");
    if (existsSync(assetsDir)) {
      const target = join(outdir, "assets");
      mkdirSync(target, { recursive: true });
      for (const name of readdirSync(assetsDir).sort()) {
        if (name.endsWith(".svg")) copyFileSync(join(assetsDir, name), join(target, name));
      }
    }
  }
  return { js };
}

export async function main(
  io: { stdout(t: string): void; stderr(t: string): void },
  root?: string,
): Promise<number> {
  try {
    const { js } = await buildSiteBundle({ write: true, root });
    io.stdout(`SITE BUILD PASS (build-site/app.js, ${Buffer.byteLength(js)} bytes)\n`);
    return 0;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    io.stderr(`SITE BUILD FAIL: ${message}\n`);
    return 1;
  }
}

if (isMainModule(import.meta.url)) {
  void main({ stdout: (t) => process.stdout.write(t), stderr: (t) => process.stderr.write(t) }).then((code) => {
    process.exitCode = code;
  });
}
