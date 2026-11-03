import { describe, expect, it, vi } from "vitest";
import { KEY_ENV } from "../src/core/config.js";
import {
  buildServerEntry,
  claudeCodeArgs,
  desktopConfigPath,
  manualClaudeCommand,
  mergeDesktopConfig,
  parseTargetSelection,
  resolveHome,
  type ServerEntry,
} from "../src/setup/targets.js";

const emptyEntry: ServerEntry = { command: "npx", args: ["-y", "korean-parenting-mcp"], env: {} };

describe("setup targets", () => {
  it("KEY_ENV has exactly the four keys", () => {
    expect(Object.values(KEY_ENV)).toEqual([
      "DATA_GO_KR_SERVICE_KEY",
      "KINDERGARTEN_API_KEY",
      "LAW_OC",
      "SAFETYKOREA_AUTH_KEY",
    ]);
  });

  it("buildServerEntry keeps all four keys in KEY_ENV order", () => {
    const entry = buildServerEntry({
      DATA_GO_KR_SERVICE_KEY: "dg-12345678",
      KINDERGARTEN_API_KEY: "kk-12345678",
      LAW_OC: "lo-12345678",
      SAFETYKOREA_AUTH_KEY: "sk-12345678",
    });
    expect(Object.keys(entry.env)).toEqual(Object.values(KEY_ENV));
    expect(entry.command).toBe("npx");
    expect(entry.args).toEqual(["-y", "korean-parenting-mcp"]);
  });

  it("buildServerEntry trims and drops blank values", () => {
    const entry = buildServerEntry({
      KINDERGARTEN_API_KEY: "  kk-12345678  ",
      LAW_OC: "   ",
      SAFETYKOREA_AUTH_KEY: "sk-12345678",
    });
    expect(entry.env).toEqual({ KINDERGARTEN_API_KEY: "kk-12345678", SAFETYKOREA_AUTH_KEY: "sk-12345678" });
  });

  it("buildServerEntry with no keys yields empty env", () => {
    expect(buildServerEntry({}).env).toEqual({});
  });

  it("resolveHome uses KPM_SETUP_HOME without calling homedir", () => {
    const homedir = vi.fn(() => {
      throw new Error("real home must not be used");
    });
    expect(resolveHome({ KPM_SETUP_HOME: "/tmp/fake" }, homedir)).toEqual({ home: "/tmp/fake", overridden: true });
    expect(homedir).not.toHaveBeenCalled();
  });

  it("resolveHome falls back to homedir when override is blank", () => {
    expect(resolveHome({ KPM_SETUP_HOME: "  " }, () => "/home/u")).toEqual({ home: "/home/u", overridden: false });
  });

  it("desktopConfigPath per platform", () => {
    expect(desktopConfigPath("/h", "darwin", {}, true)).toBe(
      "/h/Library/Application Support/Claude/claude_desktop_config.json",
    );
    expect(desktopConfigPath("/h", "linux", {}, false)).toBe("/h/.config/Claude/claude_desktop_config.json");
    expect(desktopConfigPath("C:\\h", "win32", {}, true)).toBe("C:\\h\\AppData\\Roaming\\Claude\\claude_desktop_config.json");
    expect(desktopConfigPath("C:\\h", "win32", { APPDATA: "D:\\ad" }, false)).toBe("D:\\ad\\Claude\\claude_desktop_config.json");
  });

  it("mergeDesktopConfig preserves other entries and top-level keys", () => {
    const existing = JSON.stringify({
      theme: "dark",
      mcpServers: { other: { command: "node", args: ["a.js"], env: { T: "v" } } },
    });
    const entry = buildServerEntry({ LAW_OC: "lo-12345678" });
    const result = mergeDesktopConfig(existing, entry);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = JSON.parse(result.text) as { theme: string; mcpServers: Record<string, unknown> };
    expect(parsed.theme).toBe("dark");
    expect(parsed.mcpServers.other).toEqual({ command: "node", args: ["a.js"], env: { T: "v" } });
    expect(parsed.mcpServers["korean-parenting"]).toEqual(entry);
    expect(result.replaced).toBe(false);
  });

  it("mergeDesktopConfig replaces same-name entry", () => {
    const existing = JSON.stringify({ mcpServers: { "korean-parenting": { command: "old" } } });
    const entry = buildServerEntry({ LAW_OC: "lo-12345678" });
    const result = mergeDesktopConfig(existing, entry);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.replaced).toBe(true);
    expect((JSON.parse(result.text) as { mcpServers: Record<string, unknown> }).mcpServers["korean-parenting"]).toEqual(entry);
  });

  it("mergeDesktopConfig creates a new object when file is missing", () => {
    const entry = buildServerEntry({});
    const result = mergeDesktopConfig(undefined, entry);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(result.text)).toEqual({ mcpServers: { "korean-parenting": entry } });
    expect(result.replaced).toBe(false);
  });

  it.each(["{ bad", "[1,2]", "null", '{"mcpServers":[]}'])("mergeDesktopConfig rejects %s", (text) => {
    const result = mergeDesktopConfig(text, buildServerEntry({}));
    expect(result.ok).toBe(false);
  });

  it.each([
    ["[1,2]", "최상위 값은 JSON 객체여야 합니다"],
    ['{"mcpServers":[]}', "mcpServers 값은 JSON 객체여야 합니다"],
  ])("mergeDesktopConfig reason for %s", (text, reason) => {
    const result = mergeDesktopConfig(text, buildServerEntry({}));
    expect(result).toEqual({ ok: false, reason });
  });

  it("claudeCodeArgs builds the exact argument list for two keys", () => {
    const entry = buildServerEntry({ DATA_GO_KR_SERVICE_KEY: "dg-1", SAFETYKOREA_AUTH_KEY: "sk-1" });
    const args = claudeCodeArgs(entry);
    expect(args).toEqual([
      "mcp",
      "add",
      "--transport",
      "stdio",
      "--scope",
      "user",
      "--env",
      "DATA_GO_KR_SERVICE_KEY=dg-1",
      "--env",
      "SAFETYKOREA_AUTH_KEY=sk-1",
      "korean-parenting",
      "--",
      "npx",
      "-y",
      "korean-parenting-mcp",
    ]);
    expect(Array.isArray(args)).toBe(true);
    expect(args[args.indexOf("--") - 1]).toBe("korean-parenting");
  });

  it("claudeCodeArgs has no --env without keys", () => {
    expect(claudeCodeArgs(emptyEntry)).not.toContain("--env");
  });

  it("manualClaudeCommand shows placeholders only for entered keys", () => {
    const entry = buildServerEntry({ DATA_GO_KR_SERVICE_KEY: "dg-secret-value" });
    const cmd = manualClaudeCommand(entry);
    expect(cmd).toContain("<DATA_GO_KR_SERVICE_KEY>");
    expect(cmd).not.toContain("<LAW_OC>");
    expect(cmd).not.toContain("dg-secret-value");
  });

  it("parseTargetSelection accepts 1, 2, and combinations", () => {
    expect(parseTargetSelection("")).toEqual({ ok: true, desktop: false, code: false });
    expect(parseTargetSelection("1")).toEqual({ ok: true, desktop: true, code: false });
    expect(parseTargetSelection("2")).toEqual({ ok: true, desktop: false, code: true });
    expect(parseTargetSelection("1,2")).toEqual({ ok: true, desktop: true, code: true });
    expect(parseTargetSelection(" 2 1 ")).toEqual({ ok: true, desktop: true, code: true });
  });

  it("parseTargetSelection rejects other input", () => {
    expect(parseTargetSelection("3")).toEqual({ ok: false });
    expect(parseTargetSelection("a")).toEqual({ ok: false });
  });
});
