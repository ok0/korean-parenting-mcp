import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  GH_ARGS,
  README_PREVIEW_PATH,
  checkPreview,
  localizeImages,
  main,
  previewDocument,
  type GhResult,
} from "../scripts/readme-preview.js";
import { ASSET_FILES } from "../scripts/visuals/generate.js";
import { RAW_ASSET_PREFIX, assetPairs } from "../scripts/visuals/readme-figures.js";

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
