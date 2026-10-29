import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PROVIDER_LABELS, REMOTE_POLICY } from "../../src/remote/allowlist.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const ALLOW = join(root, ".docs/remote/allowlist.md");
const CONF = join(root, ".docs/remote/provider-confirmations.md");

describe.skipIf(!existsSync(ALLOW))("remote allowlist doc", () => {
  const lines = existsSync(ALLOW) ? readFileSync(ALLOW, "utf8").split("\n") : [];
  const header = (lines.find((l) => l.startsWith("| 도구 |")) ?? "").split("|").slice(1, -1).map((c) => c.trim());
  const col = (name: string): number => header.indexOf(name);
  const rows = lines
    .filter((l) => /^\| `([a-z_]+)` \|/.test(l))
    .map((l) => l.split("|").slice(1, -1).map((c) => c.trim()));

  it("tool set matches REMOTE_POLICY", () => {
    const docTools = new Set(rows.map((c) => c[0]!.replace(/`/g, "")));
    expect(docTools).toEqual(new Set(REMOTE_POLICY.map((p) => p.tool)));
  });

  it.each(REMOTE_POLICY.map((p) => [p.tool, p] as const))("row %s matches policy", (tool, p) => {
    const cells = rows.find((c) => c[0] === `\`${tool}\``);
    expect(cells).toBeDefined();
    expect(cells![col("expose")]).toBe(p.expose ? "예" : "아니오");
    expect(cells![col("판정")]).toBe(p.verdict);
    expect(cells![col("서면 확인")]).toBe(p.providers.map((x) => `${x}: ${p.confirmation[x]}`).join(", ") || "-");
  });
});

describe.skipIf(!existsSync(CONF))("provider confirmations doc", () => {
  const text = existsSync(CONF) ? readFileSync(CONF, "utf8") : "";
  const lines = text.split("\n");

  it("has the management table header", () => {
    const header = lines.find((l) => l.includes("문의일") && l.includes("회신"));
    expect(header).toBeDefined();
    expect(header).toContain("허용 범위");
    expect(header).toContain("상태");
  });

  it.each(Object.values(PROVIDER_LABELS))("has a row for %s with not-asked", (label) => {
    const row = lines.find((l) => l.startsWith("|") && l.includes(label));
    expect(row).toBeDefined();
    expect(row).toContain("not-asked");
  });

  it("has draft sections", () => {
    expect(text).toContain("## 문의 문안 초안");
    expect(text).toContain("## 신청 사유 변경 초안");
  });

  it("contains no key-like, email or phone values", () => {
    expect(text).not.toMatch(/[A-Za-z0-9%+=]{32,}/);
    expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    expect(text).not.toMatch(/01[016789]-?\d{3,4}-?\d{4}/);
  });

  it.each(["DATA_GO_KR_SERVICE_KEY", "KINDERGARTEN_API_KEY", "LAW_OC", "SAFETYKOREA_AUTH_KEY"])(
    "does not contain the value of %s",
    (name) => {
      const v = process.env[name];
      if (v === undefined || v.length < 8) return;
      expect(text.includes(v), `value of ${name} must not appear in the doc`).toBe(false);
    },
  );
});
