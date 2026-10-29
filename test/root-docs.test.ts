import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { KEY_ENV } from "../src/core/config.js";
import { allTools } from "../src/tools/registry.js";
import { findLeaks } from "../scripts/lib/sample-mask.js";

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
    expect(row("check_recall")).toContain("(ii)");
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
