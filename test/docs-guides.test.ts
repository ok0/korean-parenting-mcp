import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { allTools } from "../src/tools/registry.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const docs = join(root, ".docs");
const read = (name: string): string => readFileSync(join(docs, name), "utf8");
const row = (text: string, name: string): string =>
  text.split("\n").find((l) => l.startsWith("| `" + name + "` |")) ?? "";

describe.skipIf(!existsSync(docs))("local release guides (.docs)", () => {
  it("guides exist", () => {
    for (const name of [
      "keys-guide.md",
      "datasets.md",
      "tool-status.md",
      "revision-ci.md",
      "CHANGELOG.md",
      "release-checklist.md",
      "known-limitations.md",
      "verification-log.md",
    ]) {
      expect(existsSync(join(docs, name)), name).toBe(true);
    }
  });

  it("tool status covers every tool", () => {
    const status = read("tool-status.md");
    for (const t of allTools) {
      expect(row(status, t.name), t.name).not.toBe("");
    }
    expect(row(status, "check_recall")).toContain("(i)");
    const daycare = row(status, "find_daycare");
    expect(daycare).toContain("(iii)");
    expect(daycare).toContain("D1");
    const checkup = row(status, "find_checkup_clinic");
    expect(checkup).toContain("(iii)");
    expect(checkup).toContain("15154419");
    expect(row(status, "find_vaccination_clinic")).toContain("(iii)");
  });

  it("keys guide content", () => {
    const keys = read("keys-guide.md");
    for (const phrase of [
      "data.go.kr",
      "Decoding",
      "e-childschoolinfo",
      "LAW_OC",
      "IP",
      "AuthKey",
      "SAFETYKOREA_AUTH_KEY",
      "비공식",
      "의료",
    ]) {
      expect(keys, phrase).toContain(phrase);
    }
  });

  it("datasets content", () => {
    const datasets = read("datasets.md");
    for (const phrase of ["법제처", "유치원알리미", "A9", "출처"]) {
      expect(datasets, phrase).toContain(phrase);
    }
  });

  it("revision CI content", () => {
    const ci = read("revision-ci.md");
    for (const phrase of ["10", "보류", "자체 호스팅", "cron", "LAW_OC", "DATA_GO_KR_SERVICE_KEY", "PR"]) {
      expect(ci, phrase).toContain(phrase);
    }
  });

  it("changelog spans M1..M18", () => {
    const changelog = read("CHANGELOG.md");
    expect(changelog).toMatch(/\bM1\b/);
    expect(changelog).toMatch(/\bM18\b/);
  });

  it("known limitations", () => {
    const limits = read("known-limitations.md");
    for (const phrase of ["find_daycare", "tmp", "@inquirer/editor", "zod"]) {
      expect(limits, phrase).toContain(phrase);
    }
  });

  it("release checklist", () => {
    const checklist = read("release-checklist.md");
    for (const phrase of ["재발급", "시크릿", "workflow_dispatch", "SafetyKorea", ".mcpb", "PAC5", "prepublishOnly"]) {
      expect(checklist, phrase).toContain(phrase);
    }
  });

  it("sign-off section ready", () => {
    const log = read("verification-log.md");
    const heading = "## 사람 서명 대기(릴리스 전 수동 점검)";
    const idx = log.indexOf(heading);
    expect(idx).toBeGreaterThanOrEqual(0);
    const section = log.slice(idx + heading.length);
    for (const phrase of ["검증자:", "확인일:", "p.110", "상한+1개월−1일"]) {
      expect(section, phrase).toContain(phrase);
    }
  });
});
