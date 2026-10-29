import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PROVIDER_LABELS, REMOTE_POLICY } from "../../src/remote/allowlist.js";
import { PRIVACY_SECTIONS } from "../../src/remote/privacy.js";
import { UPSTREAM_BUCKETS, DEFAULT_BUDGETS, DEFAULT_MIN_TTL_MS } from "../../src/core/upstream-guard.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const ALLOW = join(root, ".docs/remote/allowlist.md");
const CONF = join(root, ".docs/remote/provider-confirmations.md");
const QUOTA = join(root, ".docs/remote/quota.md");
const PRIVACY = join(root, ".docs/remote/privacy-policy-draft.md");

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

describe.skipIf(!existsSync(QUOTA))("quota doc", () => {
  const text = existsSync(QUOTA) ? readFileSync(QUOTA, "utf8") : "";
  const lines = text.split("\n");

  it.each(UPSTREAM_BUCKETS.map((b) => [b] as const))("table matches defaults for %s", (b) => {
    const line = lines.find((l) => l.startsWith(`| ${b} |`));
    expect(line).toBeDefined();
    const cells = line!.split("|").slice(1, -1).map((c) => c.trim());
    expect(cells[1]).toBe(String(DEFAULT_BUDGETS[b]));
    expect(cells[2]).toBe(String(DEFAULT_MIN_TTL_MS[b]));
  });

  it("mentions env and limits", () => {
    for (const s of [
      "KPM_BUDGET_NEMC_LIST",
      "KPM_MIN_TTL_NEMC_LIST_MS",
      "KPM_MIN_TTL_DEFAULT_MS",
      "KPM_ALERT_RATIO",
      "KPM_ALERT_WEBHOOK_URL",
      "86400000",
      "ADR-27",
      "ADR-34",
      "M25",
      "재시작",
      "단일 인스턴스",
      "최대 30분",
    ]) {
      expect(text, s).toContain(s);
    }
  });
});

describe.skipIf(!existsSync(PRIVACY))("privacy policy draft doc", () => {
  const text = existsSync(PRIVACY) ? readFileSync(PRIVACY, "utf8") : "";
  const lines = text.split("\n");
  const ENV_NAMES = ["KPM_OPERATOR_CONTACT", "KPM_HOST_PROVIDER", "KPM_HOST_COUNTRY", "KPM_HOST_REGION", "KPM_HOST_LOG_RETENTION", "KPM_HOST_REQUEST_LOGS"];

  it("has sections a–e and legal disclaimer", () => {
    for (const h of ["## (a) 게시 내용 초안", "## (b) 필수 항목별 근거", "## (c) 작성지침 대조 체크리스트 (MANUAL)", "## (d) 환경변수 값 예시", "## (e) 코드 동작과 처리방침 문장 대응표"]) {
      expect(text).toContain(h);
    }
    expect(text).toContain("법률 자문이 아닙니다");
  });

  it("draft has no 2-minute wording", () => {
    expect(text).not.toContain("약 2분");
    expect(text).not.toContain("최대 2분");
  });

  it("has MANUAL checklist with blank verifier/date", () => {
    expect(lines.some((l) => l.includes("| 항목 | 지침 조항 | 검증자 | 일자 | 결과 |"))).toBe(true);
    const start = text.indexOf("## (c) 작성지침 대조 체크리스트 (MANUAL)");
    const end = text.indexOf("## (d)", start);
    const section = text.slice(start, end);
    for (const id of PRIVACY_SECTIONS.map((s) => s.id)) {
      expect(section.split("\n").some((l) => l.startsWith(`| ${id}`) || l.includes(`\`${id}\``)), id).toBe(true);
    }
  });

  it("env examples are placeholders", () => {
    for (const name of ENV_NAMES) {
      expect(new RegExp("^" + name + "=<[^>]+>$", "m").test(text), name).toBe(true);
    }
  });

  it("no real contact, vendor or key values", () => {
    for (const m of text.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) ?? []) {
      expect(m.endsWith("example.com"), m).toBe(true);
    }
    expect(text).not.toMatch(/\b(aws|lightsail|fly\.io|cloudflare|vercel|netlify|heroku|railway)\b/i);
    for (const name of [...ENV_NAMES, "DATA_GO_KR_SERVICE_KEY", "KINDERGARTEN_API_KEY", "LAW_OC", "SAFETYKOREA_AUTH_KEY"]) {
      const v = process.env[name];
      if (v === undefined || v.length < 8) continue;
      expect(text.includes(v), `value of ${name} must not appear in the doc`).toBe(false);
    }
  });
});
