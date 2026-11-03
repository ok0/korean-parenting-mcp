import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { parseArticle } from "../src/clients/law.js";
import type { ToolContext } from "../src/core/context.js";
import {
  CLINIC_REFERENCE_NOTICE,
  DRUG_REFERENCE_NOTICE,
  healthCenterNotice,
  LEGAL_REFERENCE_NOTICE,
  LOCAL_SUPPORT_NOTICE,
  LOCAL_SUPPORT_POINTER,
  POSITIVE_DISCLAIMER_MARKERS,
  REFERENCE_NOTICE,
  SOURCE_NOTICE,
} from "../src/core/notice.js";
import { runTool } from "../src/core/pipeline.js";
import { createUpstreamGuard, defaultQuotaConfig, UPSTREAM_BUCKETS, type UpstreamBucket } from "../src/core/upstream-guard.js";
import { loadData, resolveBasis } from "../src/data-store/load.js";
import { healthCenterLine, lookupHealthCenter } from "../src/region/health-centers.js";
import { createServer } from "../src/server/create-server.js";
import { allTools, type ToolDef } from "../src/tools/registry.js";
import { checkPregnancyDrugTool } from "../src/tools/check-pregnancy-drug.js";
import { checkRecallTool } from "../src/tools/check-recall.js";
import { findBenefitsTool } from "../src/tools/find-benefits.js";
import { findCheckupClinicTool } from "../src/tools/find-checkup-clinic.js";
import { findDaycareTool } from "../src/tools/find-daycare.js";
import { findKindergartenTool } from "../src/tools/find-kindergarten.js";
import { findLocalSupportTool } from "../src/tools/find-local-support.js";
import { findNightPediatricTool } from "../src/tools/find-night-pediatric.js";
import { findVaccinationClinicTool } from "../src/tools/find-vaccination-clinic.js";
import { getLeaveArticleTool } from "../src/tools/get-leave-article.js";
import { getTimelineTool } from "../src/tools/get-timeline.js";
import { REMOTE_INPUT_NOTICE, REMOTE_LAW_NOTICE, renderLandingPage, renderPrivacyPage } from "../src/remote/privacy.js";
import { buildRemoteInstructions, excludedFallback, REMOTE_POLICY, remoteTools } from "../src/remote/allowlist.js";
import { NON_TTY_MESSAGE, runSetup } from "../src/setup/setup.js";
import { DOC_NOTICE } from "../scripts/docs/links.js";
import { listDocMarkdown } from "../scripts/docs/files.js";
import {
  NEGATIVE_STEM,
  NEGATIVE_STEM_ALLOWLIST,
  NEGATIVE_STEM_ALLOWLIST_CAP,
  NEGATIVE_NOTICE_PATTERNS,
  UNOFFICIAL_KO,
  allowlistProblems,
  checkTexts,
  collapseWs,
  noWs,
  removeSegments,
  scanNegativeWording,
  stripMarkup,
  type StemAllowEntry,
} from "./helpers/affiliation-wording.js";
import { createTestContext } from "./helpers/context.js";
import { createDgkMock, dgkCtx, dgkFx, gatewayXml, jsonRes, xmlRes as dgkXmlRes } from "./helpers/dgk-mock.js";
import { createNemcMock, nemcCtx, nemcFx } from "./helpers/nemc-mock.js";
import { createSkMock, skCtx, skFx, skJson } from "./helpers/sk-mock.js";
import { createKgMock, kgCtx, kgFx, kgRes } from "./helpers/kg-mock.js";
import { createLawMock, jsonRes as lawJson } from "./helpers/law-mock.js";
import { createFakeIO, createRecordingFs, setupOpts } from "./helpers/setup-io.js";
import { pickRegion } from "./helpers/health-center-picks.js";
import { createLcgvMock, lcgvCtx, lcgvError, lcgvItems, lcgvRes, sequence } from "./helpers/lcgv-mock.js";
import { lcgvDetailItemsOf, lcgvVerbatims } from "./helpers/lcgv-verbatim.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const HOUR = 3_600_000;
const MAPO = "서울 마포구";
const totals: number[] = NEGATIVE_STEM_ALLOWLIST.map(() => 0);

function assertClean(items: { label: string; text: string; verbatim?: readonly string[] }[]): void {
  const r = checkTexts(items);
  r.totals.forEach((n, i) => {
    totals[i] = (totals[i] ?? 0) + n;
  });
  expect(r.violations).toEqual([]);
}

const textOf = (r: { content: { type: string; text?: string }[] }): string => r.content.map((c) => c.text ?? "").join("\n");

const zeroBudgets = Object.fromEntries(UPSTREAM_BUCKETS.map((b) => [b, 0])) as Record<UpstreamBucket, number>;
const quota = (ctx: ToolContext): ToolContext => ({
  ...ctx,
  upstream: createUpstreamGuard({ ...defaultQuotaConfig(), budgets: zeroBudgets }),
  notices: [],
});
const forbidden403 = () => new Response(nemcFx("nemcList/error-bad-key.xml"), { status: 403, headers: { "content-type": "application/xml" } });

function readJson(relative: string): Record<string, unknown> {
  return JSON.parse(readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8")) as Record<string, unknown>;
}

const LAW_SEARCH = readJson("./fixtures/law/law/labor-standards-act.json") as { LawSearch: { law: Record<string, string>[] } };
const LABOR_074 = readJson("./fixtures/law/lawjosub/labor-074.json");

function lawOk(): typeof fetch {
  const api = resolveBasis(loadData("leave").articles.maternity_leave.basis_ids)[0]!.law_api;
  if (api?.kind !== "law") throw new Error("maternity_leave basis is not a law");
  const row = { ...LAW_SEARCH.LawSearch.law[0]!, 법령명한글: api.law_name };
  return createLawMock(
    (url) => (url.searchParams.get("target") === "law" ? lawJson({ LawSearch: { totalCnt: "1", law: [row] } }) : undefined),
    (url) => (url.searchParams.get("target") === "lawjosub" ? lawJson(LABOR_074) : undefined),
  ).fetch;
}

const lawCtx = (f: typeof fetch, env: Record<string, string> = { LAW_OC: "ab+c/d=e1" }): ToolContext => ({
  ...createTestContext({ env }),
  fetch: f,
});

const LAW_VERBATIM: readonly string[] = parseArticle(LABOR_074).lines;

type Scenario = {
  label: string;
  def: ToolDef;
  args: Record<string, unknown>;
  ctx: () => ToolContext;
  expectError?: boolean;
  verbatim?: readonly string[];
};

const KEYED: Scenario[] = [
  { label: "drug-ok", def: checkPregnancyDrugTool, args: { drug_name: "아세트아미노펜" }, ctx: () => dgkCtx(createDgkMock()), expectError: false },
  {
    label: "drug-nokey",
    def: checkPregnancyDrugTool,
    args: { drug_name: "아세트아미노펜" },
    ctx: () => dgkCtx(createDgkMock(), { env: { DATA_GO_KR_SERVICE_KEY: "" } }),
    expectError: true,
  },
  {
    label: "drug-badkey",
    def: checkPregnancyDrugTool,
    args: { drug_name: "아세트아미노펜" },
    ctx: () => dgkCtx(createDgkMock({ dur: () => dgkXmlRes(gatewayXml("30")) })),
  },
  {
    label: "drug-zero",
    def: checkPregnancyDrugTool,
    args: { drug_name: "아세트아미노펜" },
    ctx: () => dgkCtx(createDgkMock({ dur: () => dgkXmlRes(dgkFx("durPregnancy/empty.xml")) })),
    expectError: false,
  },
  {
    label: "drug-limit22",
    def: checkPregnancyDrugTool,
    args: { drug_name: "아세트아미노펜" },
    ctx: () => dgkCtx(createDgkMock({ dur: () => dgkXmlRes(gatewayXml("22")) })),
  },
  { label: "drug-quota", def: checkPregnancyDrugTool, args: { drug_name: "아세트아미노펜" }, ctx: () => quota(dgkCtx(createDgkMock())) },
  { label: "benefits-ok", def: findBenefitsTool, args: {}, ctx: () => dgkCtx(createDgkMock()), expectError: false },
  {
    label: "benefits-nokey",
    def: findBenefitsTool,
    args: {},
    ctx: () => dgkCtx(createDgkMock(), { env: { DATA_GO_KR_SERVICE_KEY: "" } }),
    expectError: true,
  },
  {
    label: "benefits-badkey",
    def: findBenefitsTool,
    args: {},
    ctx: () => dgkCtx(createDgkMock({ benefits: () => jsonRes(dgkFx("benefitsList/error-bad-key.json"), 401) })),
  },
  { label: "benefits-zero", def: findBenefitsTool, args: { keyword: "없는검색어" }, ctx: () => dgkCtx(createDgkMock()), expectError: false },
  { label: "benefits-quota", def: findBenefitsTool, args: {}, ctx: () => quota(dgkCtx(createDgkMock())) },
  { label: "night-ok", def: findNightPediatricTool, args: { region: "성동구" }, ctx: () => nemcCtx(createNemcMock()), expectError: false },
  {
    label: "night-nokey",
    def: findNightPediatricTool,
    args: { region: "성동구" },
    ctx: () => nemcCtx(createNemcMock(), { env: { DATA_GO_KR_SERVICE_KEY: "" } }),
    expectError: true,
  },
  {
    label: "night-badkey",
    def: findNightPediatricTool,
    args: { region: "성동구" },
    ctx: () => nemcCtx(createNemcMock({ moon: forbidden403, peds: forbidden403 })),
  },
  {
    label: "night-zero",
    def: findNightPediatricTool,
    args: { region: "성동구" },
    ctx: () =>
      nemcCtx(
        createNemcMock({
          moon: () => dgkXmlRes(nemcFx("nemcMoonlight/empty.xml")),
          peds: () => dgkXmlRes(nemcFx("nemcList/empty.xml")),
        }),
      ),
    expectError: false,
  },
  {
    label: "night-limit22",
    def: findNightPediatricTool,
    args: { region: "성동구" },
    ctx: () => nemcCtx(createNemcMock({ moon: () => dgkXmlRes(gatewayXml("22")), peds: () => dgkXmlRes(gatewayXml("22")) })),
  },
  { label: "night-quota", def: findNightPediatricTool, args: { region: "성동구" }, ctx: () => quota(nemcCtx(createNemcMock())) },
  { label: "recall-ok", def: checkRecallTool, args: { product_name: "유모차" }, ctx: () => skCtx(createSkMock()), expectError: false },
  {
    label: "recall-nokey",
    def: checkRecallTool,
    args: { product_name: "유모차" },
    ctx: () => skCtx(createSkMock(), { env: { SAFETYKOREA_AUTH_KEY: "" } }),
    expectError: true,
  },
  {
    label: "recall-badkey",
    def: checkRecallTool,
    args: { product_name: "유모차" },
    ctx: () =>
      skCtx(
        createSkMock({
          recallList: () => skJson(skFx("error-4000.json")),
          fRecallList: () => skJson(skFx("error-4000.json")),
          overseasList: () => skJson(skFx("error-4000.json")),
        }),
      ),
  },
  {
    label: "recall-zero",
    def: checkRecallTool,
    args: { product_name: "유모차" },
    ctx: () =>
      skCtx(
        createSkMock({
          recallList: () => skJson(skFx("empty-2004.json")),
          fRecallList: () => skJson(skFx("empty-2004.json")),
          overseasList: () => skJson(skFx("empty-2004.json")),
        }),
      ),
    expectError: false,
  },
  { label: "recall-quota", def: checkRecallTool, args: { product_name: "유모차" }, ctx: () => quota(skCtx(createSkMock())) },
  { label: "kindergarten-ok", def: findKindergartenTool, args: { region: "성동구" }, ctx: () => kgCtx(createKgMock()), expectError: false },
  {
    label: "kindergarten-nokey",
    def: findKindergartenTool,
    args: { region: "성동구" },
    ctx: () => kgCtx(createKgMock(), { env: { KINDERGARTEN_API_KEY: "" } }),
    expectError: true,
  },
  {
    label: "kindergarten-badkey",
    def: findKindergartenTool,
    args: { region: "성동구" },
    ctx: () => kgCtx(createKgMock(() => kgRes(kgFx("denied.json")))),
  },
  {
    label: "kindergarten-zero",
    def: findKindergartenTool,
    args: { region: "성동구" },
    ctx: () => kgCtx(createKgMock(() => kgRes(kgFx("empty.json")))),
    expectError: false,
  },
  { label: "kindergarten-quota", def: findKindergartenTool, args: { region: "성동구" }, ctx: () => quota(kgCtx(createKgMock())) },
  {
    label: "leave-ok",
    def: getLeaveArticleTool,
    args: { topic: "maternity_leave" },
    ctx: () => lawCtx(lawOk()),
    expectError: false,
    verbatim: LAW_VERBATIM,
  },
  {
    label: "leave-nokey",
    def: getLeaveArticleTool,
    args: { topic: "maternity_leave" },
    ctx: () => lawCtx(createLawMock().fetch, {}),
    expectError: true,
  },
  {
    label: "leave-badkey",
    def: getLeaveArticleTool,
    args: { topic: "maternity_leave" },
    ctx: () =>
      lawCtx(
        createLawMock(
          () => new Response("사용자 정보 검증에 실패했습니다", { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } }),
        ).fetch,
      ),
  },
  { label: "leave-zero", def: getLeaveArticleTool, args: { topic: "maternity_leave" }, ctx: () => lawCtx(createLawMock().fetch) },
  { label: "leave-quota", def: getLeaveArticleTool, args: { topic: "maternity_leave" }, ctx: () => quota(lawCtx(lawOk())) },
  {
    label: "timeline-keyed-ok",
    def: getTimelineTool,
    args: { birth_date: "2026-01-31", reference_date: "2026-02-01" },
    ctx: () => nemcCtx(createNemcMock()),
  },
  {
    label: "timeline-keyed-quota",
    def: getTimelineTool,
    args: { birth_date: "2026-01-31", reference_date: "2026-02-01" },
    ctx: () => quota(nemcCtx(createNemcMock())),
  },
];

const KEYLESS: Scenario[] = [
  {
    label: "timeline-born",
    def: getTimelineTool,
    args: { birth_date: "2026-01-31", reference_date: "2026-02-01" },
    ctx: () => createTestContext({ env: {} }),
  },
  {
    label: "timeline-pregnant",
    def: getTimelineTool,
    args: { due_date: "2026-08-01", reference_date: "2026-03-01" },
    ctx: () => createTestContext({ env: {} }),
  },
  { label: "daycare", def: findDaycareTool, args: { region: "성동구" }, ctx: () => createTestContext({ env: {} }) },
  { label: "vaccination", def: findVaccinationClinicTool, args: { region: "성동구" }, ctx: () => createTestContext({ env: {} }) },
  { label: "checkup", def: findCheckupClinicTool, args: { region: "성동구" }, ctx: () => createTestContext({ env: {} }) },
];

const keylessText = async (label: string): Promise<string> => {
  const s = KEYLESS.find((x) => x.label === label)!;
  return textOf(await runTool(s.def, s.args, s.ctx()));
};

const keyedText = async (label: string): Promise<string> => {
  const s = KEYED.find((x) => x.label === label)!;
  return textOf(await runTool(s.def, s.args, s.ctx()));
};

const repoFiles: string[] = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], { cwd: ROOT, encoding: "utf8" })
  .split("\0")
  .filter((p) => p !== "")
  .filter((p) => !p.startsWith("test/") && !p.startsWith(".ensemble/") && !p.startsWith(".docs/"));

describe("affiliation wording helper", () => {
  it("allowlist is empty, cap 3, entry shape {text, reason, max}", () => {
    expect(NEGATIVE_STEM_ALLOWLIST).toEqual([]);
    expect(NEGATIVE_STEM_ALLOWLIST_CAP).toBe(3);
    const e: StemAllowEntry = { text: "t", reason: "r", max: 1 };
    expect(Object.keys(e).sort()).toEqual(["max", "reason", "text"]);
    expect(NEGATIVE_STEM.source).toBe("아니|아닌|아님|아닙");
    expect(NEGATIVE_NOTICE_PATTERNS).toHaveLength(7);
    expect(NEGATIVE_NOTICE_PATTERNS).toContain(NEGATIVE_STEM);
    expect(UNOFFICIAL_KO.length).toBe(3);
  });

  const FLAGGED = [
    `${UNOFFICIAL_KO} 도구`,
    "an UNOFFICIAL tool",
    "비제휴 안내",
    "임신 주수 무관",
    "정부와 관계없는 서비스",
    "개인 프로젝트예요",
    "자문이 아니므로",
    "공식 서비스가 아닌 도구",
    "개인 맞춤 아님",
    "공식 서비스가 아닙니다",
    "안전하다는 뜻은 아니에요",
    "A가 아니라 B",
  ];
  it.each(FLAGGED)("flags %s", (s) => {
    expect(scanNegativeWording(s).violations.length).toBeGreaterThan(0);
  });

  const CLEAN = ["않아요", "없어요", "참고용 일반 정보예요", SOURCE_NOTICE, REFERENCE_NOTICE, "진료 시간 외", "(정상 조회)"];
  it.each(CLEAN)("passes %s", (s) => {
    expect(scanNegativeWording(s).violations).toEqual([]);
  });

  it("mutating a clean sample makes it fail", () => {
    expect(scanNegativeWording(REFERENCE_NOTICE).violations).toEqual([]);
    const bad = scanNegativeWording(REFERENCE_NOTICE + " 의료 자문이 아닙니다.").violations;
    expect(bad.length).toBeGreaterThan(0);
    expect(bad.some((v) => v.includes("아닙"))).toBe(true);
  });

  it("verbatim official text: stem exempt, forbidden word still flagged", () => {
    const V = "그러하지 아니하다.";
    expect(scanNegativeWording("머리. " + V + " 꼬리", [], [V]).violations).toEqual([]);
    expect(scanNegativeWording("머리. " + V + " 꼬리").violations.length).toBeGreaterThan(0);
    expect(scanNegativeWording(V + " 의료 자문이 아닙니다.", [], [V]).violations.length).toBeGreaterThan(0);
    const W = UNOFFICIAL_KO + " " + V;
    const wv = scanNegativeWording(W, [], [W]).violations;
    expect(wv.length).toBeGreaterThan(0);
    expect(wv.some((v) => v.includes(UNOFFICIAL_KO))).toBe(true);
    expect(removeSegments("a" + V + "b", [V])).toBe("a\nb");
  });

  const E: StemAllowEntry = { text: "이 문장은 예외가 아닙니다.", reason: "합성 표본", max: 2 };

  it("allowlist: exact sentence is removed before scanning", () => {
    expect(scanNegativeWording("앞. 이 문장은 예외가 아닙니다. 뒤", [E])).toEqual({ violations: [], allowHits: [1] });
    expect(scanNegativeWording(E.text + " 그리고 아니면", [E]).violations.length).toBeGreaterThan(0);
    expect(allowlistProblems([E], [1])).toEqual([]);
  });

  it("allowlist: totals add up across texts", () => {
    expect(checkTexts([{ label: "a", text: E.text }, { label: "b", text: E.text }], [E]).totals).toEqual([2]);
  });

  it("allowlist: over max fails", () => {
    expect(allowlistProblems([{ ...E, max: 1 }], [2]).join("\n")).toMatch(/over max/);
  });

  it("allowlist: unused entry fails", () => {
    expect(allowlistProblems([E], [0]).join("\n")).toMatch(/unused/);
  });

  it("allowlist: over cap fails", () => {
    const entries: StemAllowEntry[] = ["t1", "t2", "t3", "t4"].map((text) => ({ text, reason: "r", max: 1 }));
    expect(allowlistProblems(entries, [1, 1, 1, 1]).join("\n")).toMatch(/exceeds cap 3/);
  });

  it("allowlist: empty reason fails", () => {
    expect(allowlistProblems([{ ...E, reason: " " }], [1]).join("\n")).toMatch(/empty reason/);
  });
});

describe("file layer", () => {
  it("collects the required entries", () => {
    expect(repoFiles).toEqual(expect.arrayContaining(["README.md", "package.json", "manifest.json", "site/index.html"]));
    const docs = listDocMarkdown(ROOT);
    expect(docs.length).toBeGreaterThan(0);
    for (const d of docs) expect(repoFiles).toContain(d);
    expect(repoFiles.some((p) => /^assets\/.+\.svg$/.test(p))).toBe(true);
    for (const prefix of ["src/", "scripts/", "data/", ".github/workflows/"]) {
      expect(repoFiles.some((p) => p.startsWith(prefix)), prefix).toBe(true);
    }
    expect(repoFiles.filter((p) => /^(test\/|\.ensemble\/|\.docs\/)/.test(p))).toEqual([]);
  });

  it("no negative or affiliation wording in any text file", () => {
    const items: { label: string; text: string }[] = [];
    for (const p of repoFiles) {
      const full = join(ROOT, p);
      if (!existsSync(full)) continue;
      const buf = readFileSync(full);
      if (/\.(png|jpe?g|gif|webp|ico|pdf|zip|mcpb|gz|tgz|woff2?|ttf|otf)$/i.test(p) || buf.includes(0)) continue;
      const text = buf.toString("utf8");
      items.push({ label: p, text: p.endsWith(".svg") ? stripMarkup(text) : text });
    }
    expect(items.length).toBeGreaterThan(50);
    assertClean(items);
  });
});

describe("runtime layer", () => {
  it("instructions, tools/list and unknown tool", async () => {
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const server = createServer(createTestContext());
    await server.connect(st);
    const client = new Client({ name: "t", version: "0" });
    await client.connect(ct);
    const items: { label: string; text: string }[] = [{ label: "instructions", text: client.getInstructions() ?? "" }];
    for (const tool of (await client.listTools()).tools) {
      items.push({ label: `tools/list:${tool.name}`, text: JSON.stringify(tool) });
    }
    const unknown = (await client.callTool({ name: "no_such_tool", arguments: {} })) as { content: { type: string; text?: string }[] };
    items.push({ label: "unknown tool", text: textOf(unknown) });
    expect(items.some((i) => i.label === "tools/list:find_local_support")).toBe(true);
    assertClean(items);
  });

  it("keyless tool outputs", async () => {
    const items: { label: string; text: string }[] = [];
    for (const s of KEYLESS) {
      const res = await runTool(s.def, s.args, s.ctx());
      expect(res.isError, s.label).toBeFalsy();
      items.push({ label: s.label, text: textOf(res) });
    }
    assertClean(items);
  });

  it("keyed tool outputs: ok, no key, bad key, zero, limit", async () => {
    const items: { label: string; text: string; verbatim?: readonly string[] }[] = [];
    for (const s of KEYED) {
      const res = await runTool(s.def, s.args, s.ctx());
      if (s.expectError !== undefined) expect(Boolean(res.isError), s.label).toBe(s.expectError);
      const text = textOf(res);
      expect(text.length, s.label).toBeGreaterThan(0);
      if (s.verbatim !== undefined) {
        expect(s.verbatim.length, s.label).toBeGreaterThan(0);
        for (const segment of s.verbatim) expect(text, s.label).toContain(segment);
        const rest = removeSegments(text, s.verbatim);
        expect(rest, s.label).toContain("근거 조문:");
        expect(rest, s.label).toContain(LEGAL_REFERENCE_NOTICE);
      }
      items.push({ label: s.label, text, verbatim: s.verbatim });
    }
    assertClean(items);
  });

  it("setup wizard first lines", async () => {
    const home = await mkdtemp(join(tmpdir(), "kpm-wording-"));
    try {
      const io1 = createFakeIO({ answers: [], interactive: false });
      await runSetup(setupOpts(home, io1, createRecordingFs(home)));
      const io2 = createFakeIO({ answers: [] });
      await runSetup(setupOpts(home, io2, createRecordingFs(home)));
      expect(io1.errLines[0]).toBe(NON_TTY_MESSAGE);
      expect(io2.outLines[0]).toBe("korean-parenting-mcp 설정 마법사");
      const items = [...io1.outLines, ...io1.errLines, ...io2.outLines, ...io2.errLines].map((text) => ({ label: "setup", text }));
      assertClean(items);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("remote pages and remote text", () => {
    const items: { label: string; text: string }[] = [
      {
        label: "privacy page",
        text: renderPrivacyPage({
          contact: "c",
          host: "h",
          hosting: { provider: "p", country: "US", region: "r", logRetention: "l", requestLogs: "excluded" as const },
        }),
      },
      { label: "landing page", text: renderLandingPage({ host: "h" }) },
      { label: "REMOTE_INPUT_NOTICE", text: REMOTE_INPUT_NOTICE },
      { label: "REMOTE_LAW_NOTICE", text: REMOTE_LAW_NOTICE },
      { label: "remote instructions", text: buildRemoteInstructions() },
    ];
    for (const t of remoteTools(allTools)) {
      items.push({ label: `remote tool:${t.name}`, text: `${t.title ?? ""}\n${t.description}` });
    }
    for (const p of REMOTE_POLICY) {
      const r = excludedFallback(p.tool);
      if (r !== undefined) items.push({ label: `excluded:${p.tool}`, text: textOf(r) });
    }
    assertClean(items);
  });

  it("file snapshots", () => {
    const dir = join(ROOT, "test/__snapshots__");
    const items = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => ({ label: `test/__snapshots__/${d.name}`, text: readFileSync(join(dir, d.name), "utf8") }));
    expect(items.length).toBeGreaterThan(0);
    assertClean(items);
  });
});

describe("runtime layer: find_local_support and get_timeline region (M62)", () => {
  it("find_local_support outputs: no key, ok, zero, 22, 30, stale", async () => {
    const items: { label: string; text: string; verbatim?: readonly string[] }[] = [];

    const nokey = await runTool(findLocalSupportTool, { region: MAPO }, lcgvCtx(createLcgvMock(), { noKey: true }));
    expect(nokey.isError).toBe(true);
    items.push({ label: "lcgv-nokey", text: textOf(nokey), verbatim: [] });

    const okMock = createLcgvMock({ list: () => lcgvRes("lcgvList/mapo.xml") });
    const ok = await runTool(findLocalSupportTool, { region: MAPO }, lcgvCtx(okMock, { sink: () => undefined }));
    expect(ok.isError).toBeFalsy();
    const okText = textOf(ok);
    expect(okText).toContain(LOCAL_SUPPORT_NOTICE);
    items.push({ label: "lcgv-ok", text: okText, verbatim: lcgvVerbatims(lcgvItems("lcgvList/mapo.xml"), lcgvDetailItemsOf(okMock)) });

    const zero = await runTool(findLocalSupportTool, { region: MAPO }, lcgvCtx(createLcgvMock({ list: () => lcgvError("40") }), { sink: () => undefined }));
    expect(zero.isError).toBeFalsy();
    const zeroText = textOf(zero);
    expect(zeroText).toContain(LOCAL_SUPPORT_NOTICE);
    items.push({ label: "lcgv-zero", text: zeroText, verbatim: [] });

    const limit = await runTool(findLocalSupportTool, { region: MAPO }, lcgvCtx(createLcgvMock({ list: () => lcgvError("22") }), { sink: () => undefined }));
    items.push({ label: "lcgv-limit22", text: textOf(limit), verbatim: [] });

    const badkey = await runTool(findLocalSupportTool, { region: MAPO }, lcgvCtx(createLcgvMock({ list: () => lcgvError("30") }), { sink: () => undefined }));
    items.push({ label: "lcgv-badkey30", text: textOf(badkey), verbatim: [] });

    const staleMock = createLcgvMock({ list: sequence(() => lcgvRes("lcgvList/mapo.xml"), () => lcgvError("22")) });
    const staleCtx = lcgvCtx(staleMock, { sink: () => undefined });
    await runTool(findLocalSupportTool, { region: MAPO }, staleCtx);
    staleCtx.advance(12 * HOUR + 1);
    const stale = await runTool(findLocalSupportTool, { region: MAPO }, staleCtx);
    expect(stale.isError).toBeFalsy();
    const staleText = textOf(stale);
    expect(staleText).toContain("저장해 둔 응답");
    items.push({ label: "lcgv-stale", text: staleText, verbatim: lcgvVerbatims(lcgvItems("lcgvList/mapo.xml"), lcgvDetailItemsOf(staleMock)) });

    for (const item of items) expect(item.text.length, item.label).toBeGreaterThan(0);
    assertClean(items);
  });

  it("get_timeline region outputs: found, sido only, unresolved", async () => {
    const base = { due_date: "2027-02-10", reference_date: "2026-10-28" };
    const items: { label: string; text: string; verbatim?: readonly string[] }[] = [];

    const found = pickRegion((l) => l.kind === "found");
    expect(found).toBeDefined();
    const l = found!.lookup;
    if (l.kind !== "found") throw new Error("expected found lookup");
    const foundRes = await runTool(getTimelineTool, { ...base, region: found!.text }, createTestContext({ env: {} }));
    expect(foundRes.isError).toBeFalsy();
    const foundText = textOf(foundRes);
    expect(foundText).toContain(healthCenterNotice(l.asOf));
    expect(foundText).toContain(LOCAL_SUPPORT_POINTER);
    items.push({ label: "timeline-region-found", text: foundText, verbatim: l.centers.map((c) => healthCenterLine(c)) });

    const sido = await runTool(getTimelineTool, { ...base, region: "경기도" }, createTestContext({ env: {} }));
    expect(sido.isError).toBeFalsy();
    const sidoText = textOf(sido);
    expect(sidoText).toContain(LOCAL_SUPPORT_POINTER);
    items.push({ label: "timeline-region-sido", text: sidoText, verbatim: [] });

    const unresolved = await runTool(getTimelineTool, { ...base, region: "가나다라마" }, createTestContext({ env: {} }));
    expect(unresolved.isError).toBeFalsy();
    const unresolvedText = textOf(unresolved);
    expect(unresolvedText).toContain(LOCAL_SUPPORT_POINTER);
    items.push({ label: "timeline-region-unresolved", text: unresolvedText, verbatim: [] });

    assertClean(items);
  });
});

describe("positive notice presence", () => {
  it("get_timeline born and pregnant", async () => {
    for (const label of ["timeline-born", "timeline-pregnant"]) {
      const t = await keylessText(label);
      expect(t, label).toContain(SOURCE_NOTICE);
      expect(t, label).toContain(REFERENCE_NOTICE);
    }
  });

  it("check_pregnancy_drug ok and zero", async () => {
    for (const label of ["drug-ok", "drug-zero"]) {
      expect(await keyedText(label), label).toContain(DRUG_REFERENCE_NOTICE);
    }
  });

  it("find_night_pediatric ok", async () => {
    expect(await keyedText("night-ok")).toContain(CLINIC_REFERENCE_NOTICE);
  });

  it("README, manifest, docs, Pages", () => {
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    expect(readme).toContain(SOURCE_NOTICE);
    expect(readme).toContain(REFERENCE_NOTICE);

    const manifest = (JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8")) as { description: string }).description;
    expect(manifest).toContain(SOURCE_NOTICE);
    expect(manifest).toContain(REFERENCE_NOTICE);

    for (const f of listDocMarkdown(ROOT)) {
      const md = readFileSync(join(ROOT, f), "utf8");
      expect(collapseWs(md.replace(/\n>\s?/g, " ")), f).toContain(DOC_NOTICE);
    }

    const site = collapseWs(stripMarkup(readFileSync(join(ROOT, "site/index.html"), "utf8")));
    expect(site).toContain(SOURCE_NOTICE);
    expect(site).toContain(REFERENCE_NOTICE);
  });

  it("figures", () => {
    for (const theme of ["light", "dark"]) {
      for (const name of ["tool-map", "life-timeline", "report-example"]) {
        const svg = noWs(stripMarkup(readFileSync(join(ROOT, `assets/${name}-${theme}.svg`), "utf8")));
        expect(svg, `${name}-${theme}`).toContain(noWs(SOURCE_NOTICE));
      }
      for (const name of ["life-timeline", "question-stories", "report-example"]) {
        const svg = noWs(stripMarkup(readFileSync(join(ROOT, `assets/${name}-${theme}.svg`), "utf8")));
        for (const marker of POSITIVE_DISCLAIMER_MARKERS) {
          expect(svg, `${name}-${theme}: ${marker}`).toContain(marker);
        }
      }
    }
  });
});

describe("manifest display name", () => {
  it("display_name", () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8")) as { display_name: string };
    expect(manifest.display_name).toBe("한국 육아 일정 도우미");
  });
});

describe("allowlist report", () => {
  it("allowlist within cap, every entry used, within max", () => {
    if (NEGATIVE_STEM_ALLOWLIST.length > 0) {
      console.info("NEGATIVE_STEM_ALLOWLIST", NEGATIVE_STEM_ALLOWLIST.map((e, i) => ({ ...e, hits: totals[i] })));
    }
    expect(allowlistProblems(NEGATIVE_STEM_ALLOWLIST, totals)).toEqual([]);
  });
});
