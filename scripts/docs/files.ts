import { existsSync, readdirSync } from "node:fs";
import { join, posix } from "node:path";

export const DOCS_DIR = "docs";

export function listDocMarkdown(root: string): string[] {
  if (!existsSync(join(root, DOCS_DIR))) return [];
  const out: string[] = [];
  const walk = (dirRel: string): void => {
    const entries = readdirSync(join(root, dirRel), { withFileTypes: true });
    for (const entry of entries) {
      const rel = posix.join(dirRel, entry.name);
      if (entry.isDirectory()) {
        walk(rel);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        out.push(rel);
      }
    }
  };
  walk(DOCS_DIR);
  return out.sort();
}
