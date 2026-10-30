import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { KEY_ENV } from "../src/core/config.js";
import { allTools } from "../src/tools/registry.js";
import { findLeaks } from "../scripts/lib/sample-mask.js";
import { ASSET_FILES } from "../scripts/visuals/generate.js";
import { RAW_ASSET_PREFIX, assetPairs } from "../scripts/visuals/readme-figures.js";
import { readmeIntro } from "./helpers/visuals.js";
import { OFFICIAL_CLAIM_OUTPUT, matchedPatterns } from "./helpers/wording.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const readme = readFileSync(join(root, "README.md"), "utf8");
const license = readFileSync(join(root, "LICENSE"), "utf8");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { description: string };
const ONE_LINER = "한국 임신·출산·육아 정보 MCP 서버";
const ADV = "## 선택·고급 기능";
const row = (name: string): string =>
  readme.split("\n").find((l) => l.startsWith("| `" + name + "` |")) ?? "";
const rowIdx = (name: string): number => readme.indexOf("| `" + name + "` |");

describe("root documents", () => {
  it("LICENSE is MIT with copyright", () => {
    expect(license.split("\n")[0]).toBe("MIT License");
    expect(license).toMatch(/Copyright \(c\) 2026 ok0/);
    expect(license).toContain("Permission is hereby granted");
  });

  it("README covers minimum content", () => {
    for (const phrase of [
      "비공식",
      "의료",
      "법률",
      "npx -y korean-parenting-mcp",
      "npx -y korean-parenting-mcp setup",
      "get_timeline",
      "Linux",
      "0600",
    ]) {
      expect(readme, phrase).toContain(phrase);
    }
    for (const name of Object.values(KEY_ENV)) {
      expect(readme, name).toContain(name);
    }
  });

  it("README describes mcpb install", () => {
    for (const phrase of ["npm run pack:mcpb", ".mcpb", "선택 사항", "민감 정보"]) {
      expect(readme, phrase).toContain(phrase);
    }
  });

  it("README is self-contained and not official-sounding", () => {
    expect(readme).not.toContain(".docs");
    expect(readme).not.toMatch(/(?<!비)공식\s*(서비스|앱|도구|서버|MCP)/);
    expect(readme).not.toMatch(/정부\s*(제공|공식)/);
  });

  it("title and description use the one-liner", () => {
    expect(readme.split("\n").slice(0, 5).join("\n")).toContain(ONE_LINER);
    expect(pkg.description.startsWith(ONE_LINER)).toBe(true);
    expect(pkg.description).toContain("비공식");
  });

  it("keyless features come before the optional advanced section", () => {
    const adv = readme.indexOf(ADV);
    expect(adv).toBeGreaterThan(0);
    expect(readme.indexOf("## 키 없이 쓰는 기능")).toBeGreaterThanOrEqual(0);
    expect(readme.indexOf("## 키 없이 쓰는 기능")).toBeLessThan(adv);
    expect(readme.indexOf("get_timeline")).toBeLessThan(adv);
    for (const env of Object.values(KEY_ENV)) {
      expect(readme.indexOf(env), env).toBeGreaterThan(adv);
    }
  });

  it("tool table lists every tool, keyless first", () => {
    const adv = readme.indexOf(ADV);
    for (const t of allTools) {
      expect(rowIdx(t.name), t.name).toBeGreaterThanOrEqual(0);
      if (t.requiredKeys?.length) {
        expect(rowIdx(t.name), t.name).toBeGreaterThan(adv);
      } else {
        expect(rowIdx(t.name), t.name).toBeLessThan(adv);
      }
    }
    expect(row("check_recall")).toContain("(i) ");
    expect(row("check_recall")).not.toContain("(ii)");
    expect(row("find_daycare")).toContain("(iii)");
    expect(row("find_vaccination_clinic")).toContain("(iii)");
    expect(row("find_checkup_clinic")).toContain("(iii)");
    expect(row("find_kindergarten")).toContain("(i)");
    for (const legend of ["(i) ", "(ii) ", "(iii) "]) {
      expect(readme, legend).toContain(legend);
    }
  });

  it("advanced section is a self-contained key guide", () => {
    const guide = readme.slice(readme.indexOf(ADV));
    for (const phrase of [
      "https://www.data.go.kr",
      "Decoding",
      "활용신청",
      "15000736",
      "15113968",
      "15059486",
      "15012690",
      "https://e-childschoolinfo.moe.go.kr",
      "https://open.law.go.kr",
      "IP",
      "https://www.safetykorea.kr",
      "safetykorea@korea.kr",
      "AuthKey",
    ]) {
      expect(guide, phrase).toContain(phrase);
    }
  });

  it("no remote mode and no key-like strings", () => {
    expect(readme).not.toMatch(/원격|remote|Streamable/i);
    expect(findLeaks(readme, [], { heuristic: true })).toEqual([]);
    expect(findLeaks(license, [], { heuristic: true })).toEqual([]);
  });
});

describe("README figures (M31)", () => {
  it("every ASSET_FILES light/dark pair has one <picture> with absolute raw URLs", () => {
    const pictures = [...readme.matchAll(/<picture>([\s\S]*?)<\/picture>/g)].map((m) => m[1] ?? "");
    const pairs = assetPairs(ASSET_FILES);
    expect(pictures.length, "ASSET_FILES의 그림 쌍마다 README <picture> 블록이 하나씩 필요합니다").toBe(pairs.length);
    for (const p of pairs) {
      expect(
        pictures.some(
          (pic) =>
            pic.includes(`<source media="(prefers-color-scheme: dark)" srcset="${RAW_ASSET_PREFIX}${p.dark}">`) &&
            pic.includes(`<img src="${RAW_ASSET_PREFIX}${p.light}"`),
        ),
        p.name,
      ).toBe(true);
    }
    for (const f of ASSET_FILES) {
      expect(readme).toContain(RAW_ASSET_PREFIX + f);
    }
  });

  it("README has no relative assets path and every referenced asset exists", () => {
    expect(readme).not.toMatch(/(?:src|srcset|href)="(?!https:\/\/)[^"]*assets\//);
    expect(readme).not.toMatch(/\]\((?!https:\/\/)[^)]*assets\//);
    for (const m of readme.matchAll(/raw\.githubusercontent\.com\/ok0\/korean-parenting-mcp\/main\/assets\/([^"\s)]+)/g)) {
      const name = m[1] ?? "";
      expect(existsSync(join(root, "assets", name)), name).toBe(true);
    }
    // MANUAL: GIF 녹화 후 README에 연결하면 이 demo- 검사를 지우세요(.docs/visuals/guide.md 참조).
    expect(readme).not.toContain("demo-");
    expect(readme).not.toMatch(/준비\s*중|coming soon|placeholder|TODO/i);
  });

  it("image alt texts are plain Korean sentences without digits or file names", () => {
    const imgs = [...readme.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
    expect(imgs.length).toBe(assetPairs(ASSET_FILES).length);
    for (const tag of imgs) {
      const alt = /\balt="([^"]*)"/.exec(tag)?.[1] ?? "";
      expect(alt.trim()).not.toBe("");
      expect(alt).not.toMatch(/[0-9]/);
      expect(alt).not.toMatch(/\.svg|\.gif/);
      expect(alt).toMatch(/[가-힣]/);
      expect(alt.trim().endsWith(".")).toBe(true);
    }
  });

  it("README intro (top to install heading) mentions the AI helper and claims nothing official", () => {
    const intro = readmeIntro(readme);
    expect(intro).toContain("AI 도우미");
    expect(matchedPatterns(intro, OFFICIAL_CLAIM_OUTPUT)).toEqual([]);
  });
});

describe("README Pages link (M33)", () => {
  it("README links the Pages trial in the intro (M33)", () => {
    const intro = readmeIntro(readme);
    expect(intro).toContain("](https://ok0.github.io/korean-parenting-mcp/)");
    expect(intro).toContain("체험");
  });
});
