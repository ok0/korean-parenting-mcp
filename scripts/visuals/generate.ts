import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { allTools } from "../../src/tools/registry.js";
import { isMainModule } from "../lib/script-io.js";
import { exampleTimeline } from "./example.js";
import { renderLifeTimeline } from "./life-timeline.js";
import { buildReportModel, renderReport } from "./report.js";
import { loadReportSource } from "./report-source.js";
import { renderStories } from "./stories.js";
import { FONT_STACK, THEMES } from "./theme.js";
import { renderToolMap } from "./tool-map.js";

export const ASSET_FILES = [
  "tool-map-light.svg",
  "tool-map-dark.svg",
  "life-timeline-light.svg",
  "life-timeline-dark.svg",
  "question-stories-light.svg",
  "question-stories-dark.svg",
  "report-example-light.svg",
  "report-example-dark.svg",
] as const;

export const FIGURES = [
  { name: "tool-map", caption: "한 장 지도" },
  { name: "life-timeline", caption: "생애 타임라인" },
  { name: "question-stories", caption: "질문 따라가기" },
  { name: "report-example", caption: "한 장 보고서 예시" },
] as const;

export async function buildAll(opts: { sourceDir?: string } = {}): Promise<Record<string, string>> {
  const t = exampleTimeline();
  const report = buildReportModel(loadReportSource(opts.sourceDir));
  const rendered: Record<string, string> = {};
  for (const theme of [THEMES.light, THEMES.dark]) {
    rendered[`tool-map-${theme.name}.svg`] = renderToolMap(allTools, theme);
    rendered[`life-timeline-${theme.name}.svg`] = renderLifeTimeline(t, theme);
    rendered[`question-stories-${theme.name}.svg`] = renderStories(allTools, t, theme);
    rendered[`report-example-${theme.name}.svg`] = renderReport(report, theme);
  }
  const out: Record<string, string> = {};
  for (const f of ASSET_FILES) {
    const svg = rendered[f];
    if (svg === undefined) throw new Error(`그림 누락: ${f}`);
    out[f] = svg;
  }
  return out;
}

export async function diffAssets(dir: string, opts: { sourceDir?: string } = {}): Promise<string[]> {
  const expected = await buildAll(opts);
  const diff: string[] = [];
  for (const [f, svg] of Object.entries(expected)) {
    const p = join(dir, f);
    if (!existsSync(p) || readFileSync(p, "utf8") !== svg) diff.push(f);
  }
  if (existsSync(dir)) {
    for (const e of readdirSync(dir)) {
      if (e.endsWith(".svg") && !(ASSET_FILES as readonly string[]).includes(e)) diff.push(e);
    }
  }
  return diff.sort();
}

export const PREVIEW_PATH = ".docs/visuals/preview.html";

export function previewHtml(): string {
  const head = `<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n<title>그림 미리보기</title>\n<style>body{font-family:${FONT_STACK};margin:24px;background:#F3F5F8;color:#1A1F26}.row{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:32px}figure{margin:0;padding:12px;border-radius:8px}.light{background:${THEMES.light.bg}}.dark{background:${THEMES.dark.bg};color:${THEMES.dark.text}}img{width:100%;height:auto;display:block}</style>\n</head>\n<body>\n<h1>그림 미리보기 (왼쪽 라이트 · 오른쪽 다크)</h1>\n`;
  const figures = FIGURES.map(
    ({ name, caption }) =>
      `<h2>${caption}</h2>\n<section class="row" data-figure="${name}">\n<figure class="light"><img src="../../assets/${name}-light.svg" alt="${caption} (라이트)"><figcaption>라이트</figcaption></figure>\n<figure class="dark"><img src="../../assets/${name}-dark.svg" alt="${caption} (다크)"><figcaption>다크</figcaption></figure>\n</section>\n`,
  ).join("");
  return `${head}${figures}</body>\n</html>\n`;
}

export async function main(
  argv: readonly string[],
  io: { stdout(t: string): void; stderr(t: string): void },
  root: string,
): Promise<number> {
  if (argv.length === 0) {
    const assets = join(root, "assets");
    mkdirSync(assets, { recursive: true });
    for (const [f, svg] of Object.entries(await buildAll())) {
      const p = join(assets, f);
      writeFileSync(p, svg);
      io.stdout(`${p}\n`);
    }
    const preview = join(root, PREVIEW_PATH);
    mkdirSync(dirname(preview), { recursive: true });
    writeFileSync(preview, previewHtml());
    io.stdout(`${preview}\n`);
    return 0;
  }
  if (argv.length === 1 && argv[0] === "--check") {
    const d = await diffAssets(join(root, "assets"));
    if (d.length > 0) {
      io.stderr(`${d.join("\n")}\n그림이 코드·데이터와 다릅니다. npm run visuals 로 다시 만드세요.\n`);
      return 1;
    }
    return 0;
  }
  io.stderr("사용법: generate.js [--check]\n");
  return 1;
}

if (isMainModule(import.meta.url)) {
  main(
    process.argv.slice(2),
    { stdout: (s) => process.stdout.write(s), stderr: (s) => process.stderr.write(s) },
    process.cwd(),
  ).then(
    (c) => {
      process.exitCode = c;
    },
    (e: unknown) => {
      process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
      process.exitCode = 1;
    },
  );
}
