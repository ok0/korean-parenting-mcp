export interface RootEntry {
  name: string;
  isDir: boolean;
}

export const ALLOWED_ROOT_DOCS: readonly string[] = ["LICENSE", "README.md"];

const DOC_EXT = /\.(md|markdown|mdx|txt|rst|adoc|org)$/i;
const DOC_NAME = /^(LICEN[CS]E|COPYING|NOTICE|CHANGELOG|CHANGES|HISTORY|AUTHORS|CONTRIBUTING|CODE_OF_CONDUCT|SECURITY|TODO)(\.|$)/i;
const DOC_DIRS = new Set(["docs", "doc", "documentation"]);

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
