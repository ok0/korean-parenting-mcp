import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { KEY_ENV } from "../src/core/config.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const readme = readFileSync(join(root, "README.md"), "utf8");
const license = readFileSync(join(root, "LICENSE"), "utf8");

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
});
