import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isMainModule } from "./lib/script-io.js";
import { ASSET_FILES } from "./visuals/generate.js";
import { LOCAL_ASSET_PREFIX, RAW_ASSET_PREFIX, REPO, assetPairs, type FigurePair } from "./visuals/readme-figures.js";

export const README_PREVIEW_PATH = ".docs/visuals/readme-preview.html";

export const GH_ARGS = ["api", "--method", "POST", "markdown", "--input", "-"] as const;

export interface GhResult {
  status: number | null;
  stdout: string;
  stderr: string;
  errorCode?: string;
}

export type GhRunner = (args: readonly string[], input: string) => GhResult;

export const spawnGh: GhRunner = (args, input) => {
  const r = spawnSync("gh", [...args], {
    input,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 60_000,
  });
  return {
    status: r.status,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    errorCode: (r.error as NodeJS.ErrnoException | undefined)?.code,
  };
};

export const GH_MESSAGES = {
  missing: "gh(GitHub CLI)를 찾을 수 없습니다. https://cli.github.com 에서 설치하고 gh auth login 으로 로그인한 뒤 다시 실행하세요.",
  login: "gh에 로그인되어 있지 않습니다. gh auth login 으로 로그인한 뒤 다시 실행하세요.",
  offline: "GitHub에 연결하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 실행하세요.",
  api: "GitHub API가 README 변환에 실패했습니다",
};

export function renderReadme(markdown: string, gh: GhRunner): { html: string } | { error: string } {
  const r = gh(GH_ARGS, JSON.stringify({ text: markdown, mode: "gfm", context: REPO }));
  if (r.errorCode === "ENOENT") return { error: GH_MESSAGES.missing };
  if (r.errorCode !== undefined) return { error: GH_MESSAGES.offline };
  if (r.status === 0 && r.stdout.trim() !== "") return { html: r.stdout };
  if (r.status === 4 || /HTTP 401|gh auth login/i.test(r.stderr)) return { error: GH_MESSAGES.login };
  if (/error connecting|dial tcp|no such host|could not resolve|network is unreachable|connection refused|i\/o timeout/i.test(r.stderr)) {
    return { error: GH_MESSAGES.offline };
  }
  const code = /HTTP (\d{3})/.exec(r.stderr)?.[1];
  const detail = code !== undefined ? `HTTP ${code}` : r.status === 0 ? "빈 응답" : `gh 종료 코드 ${r.status}`;
  return { error: `${GH_MESSAGES.api}(${detail}). 잠시 후 다시 실행하거나 gh auth status 로 로그인 상태를 확인하세요.` };
}

export function localizeImages(html: string): string {
  return html.split(RAW_ASSET_PREFIX).join(LOCAL_ASSET_PREFIX);
}

export function checkPreview(html: string, pairs: readonly FigurePair[], exists: (rel: string) => boolean): string[] {
  const problems: string[] = [];

  for (const m of html.matchAll(/\b(?:src|srcset)="([^"]*)"/g)) {
    const value = m[1] ?? "";
    if (value.includes("raw.githubusercontent.com/ok0/korean-parenting-mcp")) {
      problems.push(`원격 그림 주소가 남아 있습니다: ${value}`);
    }
  }

  const blocks = [...html.matchAll(/<picture\b[^>]*>([\s\S]*?)<\/picture>/g)].map((m) => m[0]);
  for (const p of pairs) {
    const block = blocks.find((b) => b.includes(LOCAL_ASSET_PREFIX + p.light) || b.includes(LOCAL_ASSET_PREFIX + p.dark));
    if (block === undefined) {
      problems.push(`<picture> 블록이 없습니다: ${p.name}`);
      continue;
    }
    const sources = [...block.matchAll(/<source\b[^>]*>/g)].map((m) => m[0]);
    const hasDarkSource = sources.some(
      (s) => s.includes(`media="(prefers-color-scheme: dark)"`) && s.includes(`srcset="${LOCAL_ASSET_PREFIX}${p.dark}"`),
    );
    if (!hasDarkSource) problems.push(`다크 <source>가 없습니다: ${p.dark}`);
    const imgs = [...block.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
    const hasLightImg = imgs.some((t) => t.includes(`src="${LOCAL_ASSET_PREFIX}${p.light}"`));
    if (!hasLightImg) problems.push(`라이트 <img>가 없습니다: ${p.light}`);
  }

  const names = new Set<string>();
  for (const m of html.matchAll(/\b(?:src|srcset)="\.\.\/\.\.\/assets\/([^"]+)"/g)) {
    names.add(m[1] ?? "");
  }
  for (const name of names) {
    if (!exists(`assets/${name}`)) problems.push(`없는 파일을 가리킵니다: assets/${name}`);
  }

  return problems;
}

export function previewDocument(body: string): string {
  const style = [
    "body{max-width:980px;margin:0 auto;padding:32px;font-family:-apple-system,BlinkMacSystemFont,\"Apple SD Gothic Neo\",\"Malgun Gothic\",system-ui,sans-serif;line-height:1.5;color:#1F2328;background:#FFFFFF}",
    "table{border-collapse:collapse}",
    "th,td{border:1px solid #D0D7DE;padding:6px 10px}",
    "pre,code{background:#F6F8FA;border-radius:6px}",
    "img{max-width:100%;height:auto}",
    ".notice{border:1px solid #D0D7DE;border-radius:6px;padding:12px 16px;background:#F6F8FA;margin-bottom:24px}",
    "@media (prefers-color-scheme: dark){body{color:#E6EDF3;background:#0D1117}th,td{border-color:#3D444D}pre,code{background:#161B22}.notice{border-color:#3D444D;background:#161B22}}",
  ].join("");
  const items = [
    "이 화면은 GitHub의 README 렌더러(gh api markdown) 결과이며, 그림 주소만 로컬 assets 파일로 바꾼 것입니다.",
    "스타일은 GitHub 화면과 완전히 같지 않을 수 있습니다.",
    "npmjs.com 화면은 패키지를 게시한 뒤에만 확인할 수 있습니다.",
    "저장소가 공개되기 전에는 README의 실제 그림 주소가 열리지 않으므로 이 미리보기로 대신 확인합니다.",
    "다크 그림은 브라우저나 OS를 다크 모드로 바꿔 확인하세요.",
  ];
  const lis = items.map((t) => `<li>${t}</li>`).join("");
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="light dark">
<title>README 미리보기</title>
<style>${style}</style>
</head>
<body>
<aside class="notice" data-notice="readme-preview"><strong>README 미리보기(로컬)</strong><ul>${lis}</ul></aside>
<article class="markdown-body">${body}</article>
</body>
</html>
`;
}

export function buildPreview(
  githubHtml: string,
  pairs: readonly FigurePair[],
  exists: (rel: string) => boolean,
): { html: string } | { problems: string[] } {
  const body = localizeImages(githubHtml);
  const problems = checkPreview(body, pairs, exists);
  if (problems.length > 0) return { problems };
  return { html: previewDocument(body) };
}

export function main(
  argv: readonly string[],
  io: { stdout(t: string): void; stderr(t: string): void },
  root: string,
  gh: GhRunner = spawnGh,
): number {
  if (argv.length > 0) {
    io.stderr("사용법: readme-preview.js\n");
    return 1;
  }
  const out = join(root, README_PREVIEW_PATH);
  const fail = (lines: string[]): number => {
    rmSync(out, { force: true });
    rmSync(out + ".tmp", { force: true });
    io.stderr(lines.join("\n") + "\n");
    return 1;
  };

  const rendered = renderReadme(readFileSync(join(root, "README.md"), "utf8"), gh);
  if ("error" in rendered) return fail([rendered.error]);

  const pairs = assetPairs(ASSET_FILES);
  const built = buildPreview(rendered.html, pairs, (rel) => existsSync(join(root, rel)));
  if ("problems" in built) {
    return fail(["README 미리보기 검사 실패:", ...built.problems.map((p) => `- ${p}`)]);
  }

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out + ".tmp", built.html);
  renameSync(out + ".tmp", out);

  for (const p of pairs) {
    io.stdout(`연결됨: ${p.name} (라이트 ${p.light} · 다크 ${p.dark})\n`);
  }
  io.stdout(`${out}\n브라우저에서 열어 확인하세요. 다크 그림은 OS나 브라우저를 다크 모드로 바꿔 보세요.\n`);
  return 0;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = main(
    process.argv.slice(2),
    { stdout: (s) => process.stdout.write(s), stderr: (s) => process.stderr.write(s) },
    process.cwd(),
  );
}
