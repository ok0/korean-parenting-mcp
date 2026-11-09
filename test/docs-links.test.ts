import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkDocLinks, formatProblem, type RepoView } from "./helpers/docs-links.js";
import { listDocMarkdown } from "../scripts/docs/files.js";
import { DOCS_BLOB, MCPB_URL } from "../scripts/docs/links.js";
import { RAW_ASSET_PREFIX } from "../scripts/visuals/readme-figures.js";

const root = fileURLToPath(new URL("../", import.meta.url));

const realView: RepoView = {
  exists: (r) => existsSync(join(root, r)),
  read: (r) => (r.endsWith(".md") && existsSync(join(root, r)) ? readFileSync(join(root, r), "utf8") : undefined),
};

function memView(map: Record<string, string>, extra: string[] = []): RepoView {
  return {
    exists: (r) => r in map || extra.includes(r),
    read: (r) => map[r],
  };
}

describe("docs link checks (M34)", () => {
  let docsBefore: string[] = [];

  beforeAll(() => {
    docsBefore = listDocMarkdown(root);
  });

  afterAll(() => {
    expect(listDocMarkdown(root)).toEqual(docsBefore);
  });

  it("README, SECURITY.md, CONTRIBUTING.md and docs/**/*.md links pass (R5, R7, M79)", () => {
    const files = ["README.md", "SECURITY.md", "CONTRIBUTING.md", ...listDocMarkdown(root)];
    expect(checkDocLinks(files, realView).map(formatProblem)).toEqual([]);
  });

  it("listDocMarkdown lists nested .md only and tolerates no docs/", () => {
    const tmp = mkdtempSync(join(tmpdir(), "docs-links-"));
    try {
      expect(listDocMarkdown(tmp)).toEqual([]);
      mkdirSync(join(tmp, "docs", "clients"), { recursive: true });
      writeFileSync(join(tmp, "docs", "b.md"), "# b\n");
      writeFileSync(join(tmp, "docs", "a.md"), "# a\n");
      writeFileSync(join(tmp, "docs", "clients", "c.md"), "# c\n");
      writeFileSync(join(tmp, "docs", "x.png"), "");
      expect(listDocMarkdown(tmp)).toEqual(["docs/a.md", "docs/b.md", "docs/clients/c.md"]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("synthetic good sample passes", () => {
    const view = memView(
      {
        "README.md": `[i](${DOCS_BLOB}docs/install.md#설치와-실행)\n[m](${MCPB_URL})\n[p](https://ok0.github.io/korean-parenting-mcp/)\n<img src="${RAW_ASSET_PREFIX}a.svg">\n[top](#제목)\n# 제목\n`,
        "docs/install.md": "# 설치와 실행\n[c](clients/vscode.md#연결-확인)\n[mail](mailto:a@b.kr)\n```md\n[x](nowhere.md)\n[.d](../.docs/x.md)\n```\n",
        "docs/clients/vscode.md": "## 연결 확인\n[back](../install.md)\n",
      },
      ["assets/a.svg"],
    );
    expect(checkDocLinks(["README.md", "docs/install.md", "docs/clients/vscode.md"], view).map(formatProblem)).toEqual([]);
  });

  it("broken relative link is reported", () => {
    const problems = checkDocLinks(["docs/a.md"], memView({ "docs/a.md": "[x](missing.md)" }));
    expect(problems).toEqual([{ file: "docs/a.md", line: 1, url: "missing.md", reason: "대상 파일 없음" }]);
  });

  it("missing anchor in another doc is reported", () => {
    const view = memView({ "docs/a.md": "[x](b.md#없음)", "docs/b.md": "# 있음" });
    const problems = checkDocLinks(["docs/a.md", "docs/b.md"], view);
    expect(problems).toEqual([{ file: "docs/a.md", line: 1, url: "b.md#없음", reason: "없는 앵커" }]);
  });

  it("missing same-file anchor is reported", () => {
    const problems = checkDocLinks(["docs/a.md"], memView({ "docs/a.md": "# 있음\n[x](#없음)" }));
    expect(problems).toEqual([{ file: "docs/a.md", line: 2, url: "#없음", reason: "없는 앵커" }]);
  });

  it("root community doc links pass in a synthetic view (M79)", () => {
    const view = memView(
      {
        "SECURITY.md": "## 신고\n[k](docs/advanced.md#키-다루기)\n[f](https://github.com/ok0/korean-parenting-mcp/security/advisories/new)\n",
        "CONTRIBUTING.md": "[s](SECURITY.md)\n[l](LICENSE)\n[i](https://github.com/ok0/korean-parenting-mcp/issues)\n",
        "docs/advanced.md": "## 키 다루기\n",
      },
      ["LICENSE"],
    );
    expect(checkDocLinks(["SECURITY.md", "CONTRIBUTING.md"], view).map(formatProblem)).toEqual([]);
  });

  it("broken root community doc link and anchor are reported (M79)", () => {
    const view = memView({
      "SECURITY.md": "[k](docs/advanced.md#없음)",
      "CONTRIBUTING.md": "[s](SECURITY.md)\n[x](GUIDE.md)",
      "docs/advanced.md": "## 키 다루기",
    });
    expect(checkDocLinks(["SECURITY.md", "CONTRIBUTING.md"], view)).toEqual([
      { file: "SECURITY.md", line: 1, url: "docs/advanced.md#없음", reason: "없는 앵커" },
      { file: "CONTRIBUTING.md", line: 2, url: "GUIDE.md", reason: "대상 파일 없음" },
    ]);
  });

  it(".docs/ link in docs is reported", () => {
    const problems = checkDocLinks(["docs/a.md"], memView({ "docs/a.md": "[x](../.docs/notes.md)" }));
    expect(problems).toEqual([{ file: "docs/a.md", line: 1, url: "../.docs/notes.md", reason: ".docs/ 링크 금지" }]);
  });

  it(".docs/ link via DOCS_BLOB in README is reported", () => {
    const url = `${DOCS_BLOB}.docs/x.md`;
    const problems = checkDocLinks(["README.md"], memView({ "README.md": `[x](${url})` }));
    expect(problems).toEqual([{ file: "README.md", line: 1, url, reason: ".docs/ 링크 금지" }]);
  });

  it("README relative docs/ link is reported", () => {
    const view = memView({ "README.md": "\n[x](docs/install.md)", "docs/install.md": "# 설치와 실행" });
    const problems = checkDocLinks(["README.md", "docs/install.md"], view);
    expect(problems).toEqual([
      { file: "README.md", line: 2, url: "docs/install.md", reason: "README의 docs/ 링크는 절대 URL이어야 함" },
    ]);
  });

  it("missing DOCS_BLOB target is reported", () => {
    const url = `${DOCS_BLOB}docs/none.md`;
    const problems = checkDocLinks(["README.md"], memView({ "README.md": `[x](${url})` }));
    expect(problems).toEqual([{ file: "README.md", line: 1, url, reason: "DOCS_BLOB 대상 파일 없음" }]);
  });

  it("missing asset is reported", () => {
    const url = `${RAW_ASSET_PREFIX}none.svg`;
    const problems = checkDocLinks(["README.md"], memView({ "README.md": `<img src="${url}">` }));
    expect(problems).toEqual([{ file: "README.md", line: 1, url, reason: "assets/ 그림 없음" }]);
  });

  it("non-https external address is reported", () => {
    const problems = checkDocLinks(["docs/a.md"], memView({ "docs/a.md": "[x](http://e.com)" }));
    expect(problems).toEqual([{ file: "docs/a.md", line: 1, url: "http://e.com", reason: "https 외 주소 형식" }]);
  });
});
