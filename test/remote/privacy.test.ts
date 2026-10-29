import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import { allTools } from "../../src/tools/registry.js";
import { DISCLAIMER_MEDICAL_LEGAL, NOTICE_UNOFFICIAL } from "../../src/tools/shared/format.js";
import {
  buildRemoteInstructions,
  REMOTE_EXCLUDED_HEADING,
  REMOTE_PRIVACY_HEADING,
  remoteTools,
} from "../../src/remote/allowlist.js";
import {
  escapeHtml,
  isKoreaCountry,
  PAGE_CSP,
  PRIVACY_POLICY_EFFECTIVE,
  PRIVACY_SECTIONS,
  REMOTE_INPUT_NOTICE,
  renderLandingPage,
  renderPrivacyPage,
} from "../../src/remote/privacy.js";
import { createMetricsLog } from "../../src/remote/metrics-log.js";
import { SERVER_INSTRUCTIONS } from "../../src/server/instructions.js";
import { checkToolMeta } from "../helpers/meta-check.js";
import { REMOTE_TEST_ENV } from "../helpers/remote-env.js";
import { OFFICIAL_CLAIM_META, OFFICIAL_CLAIM_OUTPUT, matchedPatterns } from "../helpers/wording.js";
import { rawRequest, startRemote, type StartedRemote } from "../helpers/remote-server.js";

const SECURITY = { "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" };

const opened: StartedRemote[] = [];
async function start(env: Record<string, string> = {}, extras: Parameters<typeof startRemote>[3] = {}): Promise<StartedRemote> {
  const srv = await startRemote({}, {}, { ...REMOTE_TEST_ENV, ...env }, extras);
  opened.push(srv);
  return srv;
}

afterEach(async () => {
  while (opened.length) await opened.pop()!.close();
});

function section(html: string, id: string): string {
  const m = new RegExp(`<section id="${id}">([\\s\\S]*?)</section>`).exec(html);
  if (!m) throw new Error(`section ${id} missing`);
  return m[1]!;
}

function assertClean(r: { status: number; headers: Record<string, unknown>; body: string }): void {
  expect(r.body).not.toMatch(/<script/i);
  expect(r.body).not.toMatch(/<link/i);
  expect(r.body).not.toMatch(/<img/i);
  expect(r.body).not.toMatch(/<iframe/i);
  expect(r.body).not.toMatch(/\b(src|href)\s*=\s*["']?(https?:)?\/\//i);
  expect(r.headers["set-cookie"]).toBeUndefined();
  expect(r.headers["content-security-policy"]).toBe(PAGE_CSP);
  for (const [k, v] of Object.entries(SECURITY)) expect(r.headers[k], k).toBe(v);
  expect(r.headers["content-type"]).toBe("text/html; charset=utf-8");
}

describe("privacy pages", () => {
  it("GET /privacy renders all sections (AC1)", async () => {
    const srv = await start();
    const r = await rawRequest(srv.port, { method: "GET", path: "/privacy" });
    expect(r.status).toBe(200);
    assertClean(r);
    for (const s of PRIVACY_SECTIONS) expect(() => section(r.body, s.id)).not.toThrow();
  });

  it("HEAD /privacy and / return 200 with empty body", async () => {
    const srv = await start();
    for (const path of ["/privacy", "/"]) {
      const r = await rawRequest(srv.port, { method: "HEAD", path });
      expect(r.status).toBe(200);
      expect(r.body).toBe("");
      expect(r.headers["content-security-policy"]).toBe(PAGE_CSP);
    }
  });

  it("guard rules still apply to pages", async () => {
    const srv = await start();
    const foreign = await rawRequest(srv.port, { method: "GET", path: "/privacy", headers: { host: "evil.example" } });
    expect(foreign.status).toBe(403);
    expect((await rawRequest(srv.port, { method: "GET", path: "/privacy?x=1" })).status).toBe(400);
    expect((await rawRequest(srv.port, { method: "GET", path: "/?a=b" })).status).toBe(400);
    const post = await rawRequest(srv.port, { method: "POST", path: "/privacy" });
    expect(post.status).toBe(405);
    expect(post.headers["allow"]).toBe("GET, HEAD");
    expect((await rawRequest(srv.port, { method: "GET", path: "/nope" })).status).toBe(404);
  });

  it("pages are not metered or rate limited", async () => {
    const lines: string[] = [];
    const srv = await start({}, { metrics: createMetricsLog((l) => lines.push(l)) });
    for (let i = 0; i < 5; i++) {
      expect((await rawRequest(srv.port, { method: "GET", path: "/privacy" })).status).toBe(200);
      expect((await rawRequest(srv.port, { method: "GET", path: "/" })).status).toBe(200);
    }
    expect(lines.some((l) => l.includes('"ev":"req"'))).toBe(false);
  });

  it("disclosure values appear in their sections (AC2, KR)", async () => {
    const srv = await start();
    const r = await rawRequest(srv.port, { method: "GET", path: "/privacy" });
    const html = r.body;
    const items = section(html, "items");
    expect(items).toContain("도구 인자");
    expect(items).toContain("기록하지 않습니다");
    expect(items).toContain("약 2분");
    expect(items).toContain("호스팅 업체");
    const retention = section(html, "retention");
    expect(retention).toContain("응답 후 폐기");
    expect(retention).toContain("최대 2분");
    expect(retention).toContain("log-retention-sentinel-30d");
    const outsourcing = section(html, "outsourcing");
    for (const v of ["host-provider-sentinel", "KR", "host-region-sentinel", "log-retention-sentinel-30d"]) {
      expect(outsourcing).toContain(v);
    }
    expect(section(html, "transfer")).toContain("해당 없음");
    expect(section(html, "contact")).toContain("operator-contact-sentinel@example.com");
    expect(section(html, "rights")).toContain("열람·삭제는 할 수 없습니다");
    const auto = section(html, "auto");
    expect(auto).toContain("쿠키");
    expect(auto).toContain("로컬 모드");
    const changes = section(html, "changes");
    expect(changes).toContain(PRIVACY_POLICY_EFFECTIVE);
    expect(PRIVACY_POLICY_EFFECTIVE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(html).toContain(escapeHtml(NOTICE_UNOFFICIAL));
    expect(html).toContain(escapeHtml(DISCLAIMER_MEDICAL_LEGAL));
  });

  it("non-Korea country renders overseas transfer", async () => {
    const srv = await start({ KPM_HOST_COUNTRY: "US-sentinel" });
    const r = await rawRequest(srv.port, { method: "GET", path: "/privacy" });
    const transfer = section(r.body, "transfer");
    expect(transfer).toContain("국외이전");
    expect(transfer).toContain("US-sentinel");
    expect(transfer).toContain("host-provider-sentinel");
    expect(transfer).toContain("접속 정보");
    expect(transfer).toContain("log-retention-sentinel-30d");
    expect(transfer).not.toContain("해당 없음");
  });

  it.each(["KR", "kr", " 한국 ", "대한민국", "South Korea"])("isKoreaCountry(%s) is true", (c) => {
    expect(isKoreaCountry(c)).toBe(true);
  });

  it.each(["JP", "US", "Korea, North", ""])("isKoreaCountry(%s) is false", (c) => {
    expect(isKoreaCountry(c)).toBe(false);
  });

  it("escapes markup in env values (AC3)", async () => {
    const srv = await start({
      KPM_OPERATOR_CONTACT: "<script>alert(1)</script>",
      KPM_HOST_PROVIDER: "\"><img src=x onerror=1>",
    });
    const r = await rawRequest(srv.port, { method: "GET", path: "/privacy" });
    expect(r.status).toBe(200);
    expect(r.body).not.toContain("<script");
    expect(r.body).not.toContain("<img");
    expect(r.body).toContain("&lt;script&gt;");
    expect(r.body).toContain("&quot;&gt;&lt;img");
  });

  it("escapeHtml replaces the five special characters", () => {
    expect(escapeHtml("&<>\"'")).toBe("&amp;&lt;&gt;&quot;&#39;");
  });

  it("landing page (AC5)", async () => {
    const srv = await start({ KPM_ALLOWED_HOSTS: "kpm.example.test,127.0.0.1" });
    const r = await rawRequest(srv.port, { method: "GET", path: "/", headers: { host: "127.0.0.1" } });
    expect(r.status).toBe(200);
    assertClean(r);
    expect(r.body).toContain("https://kpm.example.test/mcp");
    expect(r.body).toContain('href="/privacy"');
    expect(r.body).toContain("로컬 모드");
    expect(r.body).toContain(".mcpb");
    expect(r.body).toContain(escapeHtml(NOTICE_UNOFFICIAL));
    expect(r.body).toContain(escapeHtml(DISCLAIMER_MEDICAL_LEGAL));
  });

  it("remote tools/list and instructions carry the notice (AC6)", async () => {
    const srv = await start();
    const client = new Client({ name: "t", version: "0" });
    await client.connect(new StreamableHTTPClientTransport(srv.url));
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(9);
    for (const t of tools) {
      const local = allTools.find((x) => x.name === t.name);
      expect(local).toBeDefined();
      expect(t.description!.endsWith("\n\n" + REMOTE_INPUT_NOTICE)).toBe(true);
      expect(t.description!.startsWith(local!.description)).toBe(true);
    }
    const instructions = client.getInstructions() ?? "";
    expect(instructions).toContain(REMOTE_INPUT_NOTICE);
    expect(instructions).toContain("/privacy");
    expect(instructions).toContain(REMOTE_PRIVACY_HEADING);
    expect(instructions).toContain(REMOTE_EXCLUDED_HEADING);
    expect(instructions.startsWith(SERVER_INSTRUCTIONS)).toBe(true);
  });

  it("wording checks cover remote text (AC7, R14)", () => {
    for (const t of remoteTools(allTools)) {
      expect(checkToolMeta(t, allTools.map((n) => n.name))).toEqual([]);
    }
    const added = buildRemoteInstructions().slice(SERVER_INSTRUCTIONS.length);
    expect(matchedPatterns(added, OFFICIAL_CLAIM_META)).toEqual([]);
    expect(matchedPatterns(added, OFFICIAL_CLAIM_OUTPUT)).toEqual([]);

    const hosting = { provider: "p", country: "US", region: "r", logRetention: "l" };
    const privacy = renderPrivacyPage({ contact: "c", host: "h", hosting });
    const landing = renderLandingPage({ host: "h" });
    for (const page of [privacy, landing]) {
      const stripped = page.split(escapeHtml(NOTICE_UNOFFICIAL)).join("");
      expect(matchedPatterns(stripped, OFFICIAL_CLAIM_META)).toEqual([]);
      expect(matchedPatterns(page, OFFICIAL_CLAIM_OUTPUT)).toEqual([]);
    }
  });
});
