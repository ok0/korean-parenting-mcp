import { posix } from "node:path";
import { DOCS_BLOB } from "../../scripts/docs/links.js";
import { RAW_ASSET_PREFIX } from "../../scripts/visuals/readme-figures.js";
import { extractLinks, headingAnchors } from "./markdown.js";

export interface RepoView {
  exists(rel: string): boolean;
  read(rel: string): string | undefined;
}

export interface LinkProblem {
  file: string;
  line: number;
  url: string;
  reason: string;
}

const BAD_PERCENT = "잘못된 퍼센트 인코딩";

function safeDecode(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

export function formatProblem(p: LinkProblem): string {
  return `${p.file}:${p.line} ${p.url} — ${p.reason}`;
}

export function checkDocLinks(files: readonly string[], view: RepoView, allowMissing: readonly string[] = []): LinkProblem[] {
  const problems: LinkProblem[] = [];
  for (const file of files) {
    const md = view.read(file) ?? "";
    for (const { url, line } of extractLinks(md)) {
      const reason = checkOne(file, md, url, view, allowMissing);
      if (reason !== null) problems.push({ file, line, url, reason });
    }
  }
  return problems;
}

function checkOne(file: string, md: string, url: string, view: RepoView, allowMissing: readonly string[]): string | null {
  if (/(^|\/)\.docs(\/|#|$)/.test(url) || url.includes("/.docs/")) {
    return ".docs/ 링크 금지";
  }

  if (url.startsWith("#")) {
    const anchor = safeDecode(url.slice(1));
    if (anchor === null) return BAD_PERCENT;
    return headingAnchors(md).has(anchor) ? null : "없는 앵커";
  }

  if (url.startsWith("mailto:")) {
    return /^mailto:[^@\s]+@[^@\s]+\.[^@\s]+$/.test(url) ? null : "잘못된 mailto 형식";
  }

  if (url.startsWith(DOCS_BLOB)) {
    const rest = url.slice(DOCS_BLOB.length);
    const hash = rest.indexOf("#");
    const rawPath = hash === -1 ? rest : rest.slice(0, hash);
    const rawAnchor = hash === -1 ? "" : rest.slice(hash + 1);
    const path = safeDecode(rawPath);
    const anchor = safeDecode(rawAnchor);
    if (path === null || anchor === null) return BAD_PERCENT;
    if (!view.exists(path)) return "DOCS_BLOB 대상 파일 없음";
    if (anchor && path.endsWith(".md") && !headingAnchors(view.read(path) ?? "").has(anchor)) {
      return "없는 앵커";
    }
    return null;
  }

  if (url.startsWith(RAW_ASSET_PREFIX)) {
    const name = url.slice(RAW_ASSET_PREFIX.length).split(/[?#]/)[0] ?? "";
    return view.exists("assets/" + name) ? null : "assets/ 그림 없음";
  }

  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(url)) {
    if (!url.startsWith("https:")) return "https 외 주소 형식";
    try {
      const parsed = new URL(url);
      return parsed.hostname ? null : "잘못된 URL 형식";
    } catch {
      return "잘못된 URL 형식";
    }
  }

  if (url.startsWith("/")) return "루트 기준 주소 금지";

  const hash = url.indexOf("#");
  const beforeHash = hash === -1 ? url : url.slice(0, hash);
  const rawAnchor = hash === -1 ? "" : url.slice(hash + 1);
  const withoutQuery = beforeHash.split("?")[0] ?? "";
  const decodedPath = safeDecode(withoutQuery);
  const anchor = safeDecode(rawAnchor);
  if (decodedPath === null || anchor === null) return BAD_PERCENT;
  const target = posix.normalize(posix.join(posix.dirname(file), decodedPath));

  if (file === "README.md" && (target === "docs" || target.startsWith("docs/"))) {
    return "README의 docs/ 링크는 절대 URL이어야 함";
  }
  if (target.startsWith("../")) return "저장소 밖 경로";
  if (!view.exists(target) && allowMissing.includes(target)) return anchor ? "없는 앵커" : null;
  if (!view.exists(target)) return "대상 파일 없음";
  if (anchor && target.endsWith(".md") && !headingAnchors(view.read(target) ?? "").has(anchor)) {
    return "없는 앵커";
  }
  return null;
}
