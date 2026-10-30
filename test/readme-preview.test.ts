import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  GH_ARGS,
  PREVIEW_DIR,
  README_PREVIEW_PATH,
  checkDocPreview,
  checkPreview,
  localAssetPrefix,
  localizeDocLinks,
  localizeImages,
  main,
  previewDocument,
  previewPathFor,
  type GhResult,
} from "../scripts/readme-preview.js";
import { DOCS_BLOB, MCPB_URL, REPO_BLOB_PATH } from "../scripts/docs/links.js";
import { ASSET_FILES } from "../scripts/visuals/generate.js";
import { LOCAL_ASSET_PREFIX, RAW_ASSET_PREFIX, assetPairs } from "../scripts/visuals/readme-figures.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const pairs = assetPairs(ASSET_FILES);
const made: string[] = [];

function makeRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "kpm-readme-preview-"));
  made.push(dir);
  return dir;
}

function collector(): { io: { stdout(t: string): void; stderr(t: string): void }; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { stdout: (t) => out.push(t), stderr: (t) => err.push(t) }, out, err };
}

function fixture(list: typeof pairs): string {
  const blocks = list.map(
    (p) =>
      `<themed-picture data-catalyst-inline="true"><picture>\n  <source media="(prefers-color-scheme: dark)" srcset="${RAW_ASSET_PREFIX}${p.dark}">\n  <img src="${RAW_ASSET_PREFIX}${p.light}" alt="예시 그림입니다." width="800">\n</picture></themed-picture>`,
  );
  return `<h1 dir="auto">t</h1>\n${blocks.join("\n")}`;
}

afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("README preview (M31)", () => {
  it("assetPairs pairs every ASSET_FILES entry and rejects unpaired files", () => {
    expect(pairs.length * 2).toBe(ASSET_FILES.length);
    const flat = pairs.flatMap((p) => [p.light, p.dark]).sort();
    expect(flat).toEqual([...ASSET_FILES].sort());
    expect(() => assetPairs(["x-light.svg"])).toThrow(/x-light\.svg/);
    expect(() => assetPairs(["x-dark.svg"])).toThrow(/x-dark\.svg/);
    expect(() => assetPairs(["x.svg"])).toThrow();
  });

  it("localizeImages replaces the raw asset prefix with the local one", () => {
    const local = localizeImages(fixture(pairs));
    expect(local).not.toContain(RAW_ASSET_PREFIX);
    expect(local).toContain(`srcset="../../assets/${pairs[0]?.dark}"`);
    expect(local).toContain(`src="../../assets/${pairs[0]?.light}"`);
  });

  it("checkPreview accepts a well-formed localized fixture", () => {
    expect(checkPreview(localizeImages(fixture(pairs)), pairs, () => true)).toEqual([]);
  });

  it("checkPreview reports a leftover raw URL", () => {
    const local = localizeImages(fixture(pairs)).replace('src="../../assets/', `src="${RAW_ASSET_PREFIX}`);
    const problems = checkPreview(local, pairs, () => true);
    expect(problems.filter((p) => p.startsWith("원격 그림 주소가 남아 있습니다:"))).toHaveLength(1);
  });

  it("checkPreview reports a missing dark <source>", () => {
    const local = localizeImages(fixture(pairs)).replace(/<source\b[^>]*>/, "");
    expect(checkPreview(local, pairs, () => true)).toEqual([`다크 <source>가 없습니다: ${pairs[0]?.dark}`]);
  });

  it("checkPreview reports every pair without a <picture> block", () => {
    const local = localizeImages(fixture(pairs)).replace(/<\/?picture>/g, "");
    const problems = checkPreview(local, pairs, () => true);
    expect(problems).toHaveLength(pairs.length);
    for (const p of problems) expect(p.startsWith("<picture> 블록이 없습니다:")).toBe(true);
  });

  it("checkPreview reports a local figure file that does not exist", () => {
    const exists = (rel: string): boolean => rel !== `assets/${pairs[0]?.light}`;
    expect(checkPreview(localizeImages(fixture(pairs)), pairs, exists)).toEqual([
      `없는 파일을 가리킵니다: assets/${pairs[0]?.light}`,
    ]);
  });

  it("previewDocument carries the notice and no remote or script references", () => {
    const doc = previewDocument("");
    for (const s of ["data-notice=\"readme-preview\"", "GitHub의 README 렌더러", "완전히 같지 않을 수", "npmjs.com", "게시한 뒤에만", "공개되기 전"]) {
      expect(doc).toContain(s);
    }
    expect(doc).not.toMatch(/<script|<link|https?:|@import|url\(/i);
  });

  it("main writes the preview for a successful render", () => {
    const dir = makeRoot();
    writeFileSync(join(dir, "README.md"), "# t\n");
    mkdirSync(join(dir, "assets"));
    for (const f of ASSET_FILES) writeFileSync(join(dir, "assets", f), "<svg/>");
    const calls: { args: readonly string[]; input: string }[] = [];
    const gh = (args: readonly string[], input: string): GhResult => {
      calls.push({ args, input });
      return { status: 0, stdout: fixture(pairs), stderr: "" };
    };
    const c = collector();
    expect(main([], c.io, dir, gh)).toBe(0);

    const outFile = join(dir, README_PREVIEW_PATH);
    expect(existsSync(outFile)).toBe(true);
    const html = readFileSync(outFile, "utf8");
    expect(html).toContain('data-notice="readme-preview"');
    expect(html).not.toContain(RAW_ASSET_PREFIX);
    expect(html).not.toContain("<script");
    for (const p of pairs) expect(c.out.join("")).toContain(`연결됨: ${p.name}`);
    expect(existsSync(outFile + ".tmp")).toBe(false);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual([...GH_ARGS]);
    expect(JSON.parse(calls[0]?.input ?? "")).toEqual({
      text: "# t\n",
      mode: "gfm",
      context: "ok0/korean-parenting-mcp",
    });
  });

  it("main fails and removes a stale preview when the check fails", () => {
    const dir = makeRoot();
    writeFileSync(join(dir, "README.md"), "# t\n");
    mkdirSync(join(dir, "assets"));
    for (const f of ASSET_FILES) writeFileSync(join(dir, "assets", f), "<svg/>");
    const outFile = join(dir, README_PREVIEW_PATH);
    mkdirSync(join(dir, ".docs", "visuals"), { recursive: true });
    writeFileSync(outFile, "<html>stale</html>");
    const broken = fixture(pairs).replace(/<source\b[^>]*>/, "");
    const gh = (): GhResult => ({ status: 0, stdout: broken, stderr: "" });
    const c = collector();
    expect(main([], c.io, dir, gh)).toBe(1);
    const err = c.err.join("");
    expect(err).toContain("README 미리보기 검사 실패");
    expect(err).toContain(pairs[0]?.dark ?? "");
    expect(existsSync(outFile)).toBe(false);
  });

  it("main reports each gh failure without leaking token text", () => {
    const cases: [GhResult, string][] = [
      [{ status: null, stdout: "", stderr: "", errorCode: "ENOENT" }, "찾을 수 없습니다"],
      [
        {
          status: 4,
          stdout: "",
          stderr: "To get started with GitHub CLI, please run:  gh auth login\ntoken gho_FAKE0123456789abcdef",
        },
        "로그인되어 있지 않습니다",
      ],
      [
        { status: 1, stdout: "", stderr: "error connecting to api.github.com\ncheck your internet connection" },
        "연결하지 못했습니다",
      ],
      [
        { status: 1, stdout: "", stderr: "gh: Server Error (HTTP 500)\nAuthorization: token gho_FAKE0123456789abcdef" },
        "HTTP 500",
      ],
    ];
    const messages: string[] = [];
    for (const [result, fragment] of cases) {
      const dir = makeRoot();
      writeFileSync(join(dir, "README.md"), "# t\n");
      const c = collector();
      expect(main([], c.io, dir, () => result)).toBe(1);
      const err = c.err.join("");
      expect(err).toContain(fragment);
      expect(err).not.toContain("gho_");
      expect(err).not.toContain("FAKE0123");
      expect(existsSync(join(dir, README_PREVIEW_PATH))).toBe(false);
      messages.push(err);
    }
    expect(new Set(messages).size).toBe(cases.length);
  });

  it("main rejects arguments", () => {
    const dir = makeRoot();
    const c = collector();
    const gh = (): GhResult => ({ status: 0, stdout: "", stderr: "" });
    expect(main(["--x"], c.io, dir, gh)).toBe(1);
    expect(c.err.join("")).toContain("사용법");
  });

  it.skipIf(!existsSync(join(root, README_PREVIEW_PATH)))("generated readme-preview.html is safe and git-ignored", () => {
    const html = readFileSync(join(root, README_PREVIEW_PATH), "utf8");
    expect(html).toContain('data-notice="readme-preview"');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain(`src="${RAW_ASSET_PREFIX}`);
    expect(html).not.toContain(`srcset="${RAW_ASSET_PREFIX}`);
    for (const m of html.matchAll(/(?:src|srcset)="..\/..\/assets\/([^"]+)"/g)) {
      expect(existsSync(join(root, "assets", m[1] ?? "")), m[1]).toBe(true);
    }
    const inRepo = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: root, encoding: "utf8" }).status === 0;
    if (inRepo) {
      expect(spawnSync("git", ["check-ignore", "-q", README_PREVIEW_PATH], { cwd: root }).status).toBe(0);
    }
  });
});

describe("docs preview (M34)", () => {
  const docPage = "docs/install.md";
  const vscodePage = "docs/clients/vscode.md";

  function fixtureDocs(): { README: string; install: string; vscode: string } {
    return {
      README: fixture(pairs) + `<a href="${DOCS_BLOB}docs/install.md">i</a>`,
      install: `<a href="clients/vscode.md#연결-확인">v</a><img src="${RAW_ASSET_PREFIX}${ASSET_FILES[0]}">`,
      vscode: `<a href="../install.md">i</a><a href="${MCPB_URL}">m</a>`,
    };
  }

  function docsRoot(): string {
    const dir = makeRoot();
    writeFileSync(join(dir, "README.md"), "# t\n");
    mkdirSync(join(dir, "assets"));
    for (const f of ASSET_FILES) writeFileSync(join(dir, "assets", f), "<svg/>");
    mkdirSync(join(dir, "docs", "clients"), { recursive: true });
    writeFileSync(join(dir, "docs", "install.md"), "# install\n");
    writeFileSync(join(dir, "docs", "clients", "vscode.md"), "# vscode\n");
    return dir;
  }

  function ghByText(texts: Record<string, string>, calls: string[]): (args: readonly string[], input: string) => GhResult {
    return (_args, input) => {
      const text = (JSON.parse(input) as { text: string }).text;
      calls.push(text);
      const html = texts[text];
      return { status: 0, stdout: html ?? "", stderr: "" };
    };
  }

  it("previewPathFor and localAssetPrefix follow the output depth", () => {
    expect(previewPathFor("docs/install.md")).toBe(".docs/visuals/preview/docs/install.html");
    expect(localAssetPrefix(README_PREVIEW_PATH)).toBe(LOCAL_ASSET_PREFIX);
    expect(localAssetPrefix(previewPathFor("README.md"))).toBe("../../../assets/");
    expect(localAssetPrefix(previewPathFor("docs/install.md"))).toBe("../../../../assets/");
    expect(localAssetPrefix(previewPathFor("docs/clients/vscode.md"))).toBe("../../../../../assets/");
  });

  it("localizeDocLinks rewrites doc links relative to fromPath", () => {
    const from = "docs/clients/vscode.md";
    expect(localizeDocLinks(`<a href="${DOCS_BLOB}docs/install.md#설치">x</a>`, from)).toBe(
      `<a href="../install.html#설치">x</a>`,
    );
    expect(localizeDocLinks(`<a href="../install.md#a">x</a>`, from)).toBe(`<a href="../install.html#a">x</a>`);
    expect(localizeDocLinks(`<a href="README.md">x</a>`, from)).toBe(`<a href="README.html">x</a>`);
    expect(localizeDocLinks(`<a href="${REPO_BLOB_PATH}docs/install.md">x</a>`, from)).toBe(
      `<a href="../install.html">x</a>`,
    );
    expect(localizeDocLinks(`<a href="${DOCS_BLOB}docs/clients/README.md">x</a>`, "README.md")).toBe(
      `<a href="docs/clients/README.html">x</a>`,
    );
  });

  it("localizeDocLinks points images at real assets at any depth", () => {
    const root = docsRoot();
    for (const fromPath of ["README.md", "docs/install.md", "docs/clients/vscode.md"]) {
      const html = `<img src="${RAW_ASSET_PREFIX}${ASSET_FILES[0]}"><source srcset="${RAW_ASSET_PREFIX}${ASSET_FILES[1]}">`;
      const localized = localizeDocLinks(html, fromPath);
      const values = [...localized.matchAll(/(?:src|srcset)="([^"]*)"/g)].map((m) => m[1] ?? "");
      expect(values).toHaveLength(2);
      const expectedFiles = [ASSET_FILES[0], ASSET_FILES[1]];
      values.forEach((v, i) => {
        const resolved = posix.normalize(posix.join(posix.dirname(previewPathFor(fromPath)), v));
        expect(resolved).toBe(`assets/${expectedFiles[i]}`);
        expect(existsSync(join(root, resolved))).toBe(true);
      });
    }

    const relative = localizeDocLinks(`<img src="../../assets/${ASSET_FILES[0]}">`, vscodePage);
    const resolvedRel = posix.normalize(posix.join(posix.dirname(previewPathFor(vscodePage)), relative.match(/src="([^"]*)"/)?.[1] ?? ""));
    expect(resolvedRel).toBe(`assets/${ASSET_FILES[0]}`);

    const camo = localizeDocLinks(
      `<img src="https://camo.githubusercontent.com/x" data-canonical-src="${RAW_ASSET_PREFIX}${ASSET_FILES[0]}">`,
      docPage,
    );
    expect(camo).not.toContain("camo");
    expect(camo).not.toContain("data-canonical-src");
    expect(camo).toMatch(/src="[^"]*assets\//);
  });

  it("localizeDocLinks leaves external, mcpb, mailto, anchors and non-md blobs", () => {
    const inputs = [
      "https://example.com/x",
      MCPB_URL,
      "mailto:a@b.kr",
      "#local",
      `${DOCS_BLOB}LICENSE`,
    ];
    for (const v of inputs) {
      const html = `<a href="${v}">x</a>`;
      expect(localizeDocLinks(html, docPage)).toBe(html);
    }
  });

  it("checkDocPreview reports leftovers and missing targets", () => {
    const outPath = previewPathFor(docPage);
    const exists = (r: string): boolean => r === "assets/a.svg" || r === ".docs/visuals/preview/docs/ok.html";
    expect(checkDocPreview(`<a href="ok.html">x</a><img src="../../../../assets/a.svg">`, outPath, exists)).toEqual([]);

    const remoteDoc = checkDocPreview(`<a href="${DOCS_BLOB}docs/x.md">x</a>`, outPath, exists);
    expect(remoteDoc.filter((p) => p.startsWith("원격 문서 링크가 남아 있습니다:"))).toHaveLength(1);

    const remoteImg = checkDocPreview(`<img src="${RAW_ASSET_PREFIX}a.svg">`, outPath, exists);
    expect(remoteImg.filter((p) => p.startsWith("원격 그림 주소가 남아 있습니다:"))).toHaveLength(1);

    expect(checkDocPreview(`<a href="missing.html">x</a>`, outPath, exists)).toEqual([
      "없는 파일을 가리킵니다: .docs/visuals/preview/docs/missing.html",
    ]);
    expect(checkDocPreview(`<img src="../../../../assets/none.svg">`, outPath, exists)).toEqual([
      "없는 파일을 가리킵니다: assets/none.svg",
    ]);
    expect(checkDocPreview(`<a href="${DOCS_BLOB}LICENSE">x</a>`, outPath, exists)).toEqual([]);
  });

  it("main previews README and every docs markdown", () => {
    const dir = docsRoot();
    const texts = fixtureDocs();
    const seen: string[] = [];
    const gh = ghByText({ "# t\n": texts.README, "# install\n": texts.install, "# vscode\n": texts.vscode }, seen);
    const c = collector();
    expect(main([], c.io, dir, gh)).toBe(0);
    expect(seen).toHaveLength(3);

    expect(existsSync(join(dir, README_PREVIEW_PATH))).toBe(true);
    expect(existsSync(join(dir, previewPathFor("README.md")))).toBe(true);
    expect(existsSync(join(dir, previewPathFor(docPage)))).toBe(true);
    expect(existsSync(join(dir, previewPathFor(vscodePage)))).toBe(true);

    const install = readFileSync(join(dir, previewPathFor(docPage)), "utf8");
    expect(install).toContain('href="clients/vscode.html#연결-확인"');
    expect(install).not.toContain(RAW_ASSET_PREFIX);

    const readme = readFileSync(join(dir, previewPathFor("README.md")), "utf8");
    expect(readme).toContain('href="docs/install.html"');

    const vscode = readFileSync(join(dir, previewPathFor(vscodePage)), "utf8");
    expect(vscode).toContain(MCPB_URL);
  });

  it("main without docs/ writes only README outputs", () => {
    const dir = makeRoot();
    writeFileSync(join(dir, "README.md"), "# t\n");
    mkdirSync(join(dir, "assets"));
    for (const f of ASSET_FILES) writeFileSync(join(dir, "assets", f), "<svg/>");
    const c = collector();
    expect(main([], c.io, dir, () => ({ status: 0, stdout: fixture(pairs), stderr: "" }))).toBe(0);
    expect(existsSync(join(dir, previewPathFor("README.md")))).toBe(true);
    expect(readdirSync(join(dir, PREVIEW_DIR))).toEqual(["README.html"]);
  });

  it("main writes nothing when one doc fails the check", () => {
    const dir = docsRoot();
    const texts = fixtureDocs();
    const broken = texts.install.replace("clients/vscode.md#연결-확인", `${DOCS_BLOB}docs/missing.md`);
    const outFile = join(dir, README_PREVIEW_PATH);
    mkdirSync(join(dir, ".docs", "visuals", "preview"), { recursive: true });
    writeFileSync(outFile, "<html>stale</html>");
    writeFileSync(join(dir, PREVIEW_DIR, "old.html"), "<html>old</html>");
    const gh = ghByText({ "# t\n": texts.README, "# install\n": broken, "# vscode\n": texts.vscode }, []);
    const c = collector();
    expect(main([], c.io, dir, gh)).toBe(1);
    const err = c.err.join("");
    expect(err).toContain("문서 미리보기 검사 실패");
    expect(err).toContain("docs/install.md");
    expect(err).toContain("missing");
    expect(existsSync(outFile)).toBe(false);
    expect(existsSync(join(dir, PREVIEW_DIR))).toBe(false);
  });

  it("main reports a doc render failure with its path and no token", () => {
    const dir = docsRoot();
    const gh = (_args: readonly string[], input: string): GhResult => {
      const text = (JSON.parse(input) as { text: string }).text;
      if (text === "# t\n") return { status: 0, stdout: fixture(pairs), stderr: "" };
      if (text === "# vscode\n") return { status: 0, stdout: fixtureDocs().vscode, stderr: "" };
      return { status: 1, stdout: "", stderr: "gh: Server Error (HTTP 500)\nAuthorization: token gho_FAKE0123456789abcdef" };
    };
    const c = collector();
    expect(main([], c.io, dir, gh)).toBe(1);
    const err = c.err.join("");
    expect(err).toContain("docs/install.md:");
    expect(err).toContain("HTTP 500");
    expect(err).not.toContain("gho_");
    expect(existsSync(join(dir, README_PREVIEW_PATH))).toBe(false);
    expect(existsSync(join(dir, PREVIEW_DIR))).toBe(false);
  });

  it("clients link passes only when the file exists (M36, no pending exception)", () => {
    const texts = fixtureDocs();
    const withFile = docsRoot();
    writeFileSync(join(withFile, "docs", "index-a3.md"), "# a\n");
    writeFileSync(join(withFile, "docs", "clients", "README.md"), "# c\n");
    const runner = ghByText(
      {
        "# t\n": texts.README,
        "# install\n": texts.install,
        "# vscode\n": texts.vscode,
        "# a\n": '<a href="clients/README.md">c</a>',
        "# c\n": '<a href="../install.md">i</a>',
      },
      [],
    );
    expect(main([], collector().io, withFile, runner)).toBe(0);

    const missing = docsRoot();
    writeFileSync(join(missing, "docs", "index-a3.md"), "# a\n");
    const runner2 = ghByText(
      { "# t\n": texts.README, "# install\n": texts.install, "# vscode\n": texts.vscode, "# a\n": '<a href="clients/README.md">c</a>' },
      [],
    );
    const c2 = collector();
    expect(main([], c2.io, missing, runner2)).toBe(1);
    expect(c2.err.join("")).toContain("없는 파일을 가리킵니다");
  });
});
