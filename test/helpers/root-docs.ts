import { existsSync, readdirSync } from "node:fs";
import { join, posix } from "node:path";

export interface RootEntry {
  name: string;
  isDir: boolean;
}

export const ALLOWED_ROOT_DOCS: readonly string[] = ["CONTRIBUTING.md", "LICENSE", "README.md", "SECURITY.md"];

const DOC_EXT = /\.(md|markdown|mdx|txt|rst|adoc|org)$/i;
const DOC_NAME = /^(LICEN[CS]E|COPYING|NOTICE|CHANGELOG|CHANGES|HISTORY|AUTHORS|CONTRIBUTING|CODE_OF_CONDUCT|SECURITY|TODO)(\.|$)/i;
const DOC_DIRS = new Set(["doc", "documentation"]);

export function rootDocViolations(entries: readonly RootEntry[]): string[] {
  const out: string[] = [];
  for (const e of entries) {
    if (e.isDir) {
      if (DOC_DIRS.has(e.name.toLowerCase())) out.push(e.name + "/");
    } else if ((DOC_EXT.test(e.name) || DOC_NAME.test(e.name)) && !ALLOWED_ROOT_DOCS.includes(e.name)) {
      out.push(e.name);
    }
  }
  return out.sort();
}

/** P12: docs/ 아래(재귀)는 .md 파일만. docs/가 없으면 []. .DS_Store는 무시. 반환은 "docs/…" POSIX 경로, 정렬. 디렉터리는 재귀, 일반 파일이 아닌 항목(심볼릭 링크 등)은 위반. */
export function docsDirViolations(root: string): string[] {
  const base = join(root, "docs");
  if (!existsSync(base)) return [];
  const out: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === ".DS_Store") continue;
      const childRel = posix.join(rel, e.name);
      if (e.isDirectory()) {
        walk(join(dir, e.name), childRel);
      } else if (!(e.isFile() && e.name.endsWith(".md"))) {
        out.push(childRel);
      }
    }
  };
  walk(base, "docs");
  return out.sort();
}
