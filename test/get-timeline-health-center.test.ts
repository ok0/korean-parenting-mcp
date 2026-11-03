import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { finalize, runTool } from "../src/core/pipeline.js";
import { loadData, resolveBasis } from "../src/data-store/load.js";
import {
  HEALTH_CENTER_BASIS_ID,
  HEALTH_CENTER_PRIMARY_KINDS,
  type HealthCenterEntry,
  type HealthCentersFile,
  type SigunguEntry,
} from "../src/data-store/schema.js";
import {
  HEALTH_CENTER_PREPARING,
  HEALTH_CENTER_UNRESOLVED_LINKS,
  LOCAL_SUPPORT_POINTER,
  healthCenterNotice,
} from "../src/core/notice.js";
import { keylessStatus } from "../src/provenance/revision-text.js";
import {
  HEALTH_CENTER_MULTIPLE,
  HEALTH_CENTER_REGION_HINT,
  HEALTH_CENTER_SIDO_ONLY,
  healthCenterLine,
  lookupHealthCenter,
  type HealthCenterLookup,
} from "../src/region/health-centers.js";
import { getTimelineTool } from "../src/tools/get-timeline.js";
import type { ToolOutput } from "../src/tools/registry.js";
import {
  DISCLAIMER_MEDICAL_LEGAL,
  NOTICE_SOURCE,
  basisLine,
  revisionLine,
  revisionSummary,
  verifiedText,
} from "../src/tools/shared/format.js";
import { computeOfflineTimeline, type OfflineTimeline } from "../src/timeline/offline.js";
import {
  HEALTH_CENTER_BRANCH_NOTE,
  footerBasisIds,
  healthCenterBlock,
  renderLocalSection,
  renderTimeline,
} from "../src/timeline/render.js";
import { localGuidance } from "../src/timeline/rules/local.js";
import type { LocalGuidanceSection } from "../src/timeline/types.js";
import { createTestContext } from "./helpers/context.js";
import { BUNDLED, fakeCenter, pickRegion, regionText, syntheticFile } from "./helpers/health-center-picks.js";
import { LOCAL_ASSERTIVE, NEGATIVE_STEM, UNOFFICIAL_KO } from "./helpers/affiliation-wording.js";

const REF = "2026-10-28";
const PREG = { due_date: "2027-02-10", reference_date: REF };
const BORN = { birth_date: "2026-05-28", reference_date: REF };
const MAXW = { months_ahead: 156, include_past: true };
const BORN_MAX = { birth_date: "2026-01-31", reference_date: "2026-02-01", ...MAXW };
const TODAY = { y: 2026, m: 1, d: 1 };
const BASIS = "[health-center-standard-data]";
const MAX = getTimelineTool.maxChars!;

const blocks: string[] = [];

type Found = Extract<HealthCenterLookup, { kind: "found" }>;

function throwingFetch() {
  return vi.fn(async (): Promise<Response> => {
    throw new Error("network disabled");
  });
}

let globalFetch: ReturnType<typeof throwingFetch>;

beforeEach(() => {
  globalFetch = throwingFetch();
  vi.stubGlobal("fetch", globalFetch);
});

afterEach(() => {
  try {
    expect(globalFetch).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});

function ctxWith(env: Record<string, string>) {
  return { ...createTestContext({ env }), fetch: throwingFetch() };
}

const keyless = () => ctxWith({});
const keyed = () => ctxWith({ DATA_GO_KR_SERVICE_KEY: "m59-fake-key-0000" });

const call = (args: Record<string, unknown>, ctx = keyless()) => runTool(getTimelineTool, args, ctx);
const text = (r: { content: { type: string; text?: string }[] }): string => r.content[0]!.text ?? "";
const countOf = (t: string, s: string): number => t.split(s).length - 1;
const blockText = (h: HealthCenterLookup): string => healthCenterBlock(h).join("\n");
const contactText = (c: HealthCenterEntry, asOf: string, prefix = ""): string =>
  `보건소 연락처(${prefix}목록 기준일 ${asOf}, ${verifiedText(c.verified)}): ${healthCenterLine(c)}`;

function section(mode: "born" | "pregnant", region: string | undefined, data: HealthCentersFile): LocalGuidanceSection {
  return localGuidance({ mode, region }, undefined, (t) => lookupHealthCenter(t, data));
}

function asFound(l: HealthCenterLookup | undefined): Found {
  if (l?.kind !== "found") throw new Error("expected a found lookup");
  return l;
}

function sggWhere(pred: (g: SigunguEntry) => boolean): SigunguEntry {
  const g = loadData("regions").sigungu.find(pred);
  if (g === undefined) throw new Error("no sigungu matches");
  return g;
}

const parentCodes = new Set(loadData("regions").sigungu.map((g) => g.parent_code));
const branchOnly = (g: SigunguEntry): boolean => g.parent_code === undefined && !parentCodes.has(g.code);

function worstOutput(off: OfflineTimeline, s: LocalGuidanceSection): ToolOutput {
  return renderTimeline(off.result, off.view, s, resolveBasis(footerBasisIds(off.result, s)).map(keylessStatus));
}

describe("get_timeline health center block", () => {
  it("found sigungu from the bundled list renders contact lines, notice and pointer", async () => {
    const pick = pickRegion((l) => l.kind === "found" && l.scope === "sigungu");
    expect(pick).toBeDefined();
    const p = pick!;
    const expected = BUNDLED.centers
      .filter((c) => c.code === p.sgg.code && (HEALTH_CENTER_PRIMARY_KINDS as readonly string[]).includes(c.kind))
      .slice(0, 3);
    expect(expected.length).toBeGreaterThan(0);
    for (const args of [PREG, BORN]) {
      const r = await call({ ...args, region: p.text });
      const t = text(r);
      expect(r.isError).toBeFalsy();
      for (const c of expected) expect(t).toContain(contactText(c, BUNDLED.as_of));
      expect(t).toContain(healthCenterNotice(BUNDLED.as_of));
      expect(countOf(t, LOCAL_SUPPORT_POINTER)).toBe(1);
      expect(countOf(t, BASIS)).toBe(1);
      expect(t.indexOf("지역·기관별 확인 사항")).toBeLessThan(t.indexOf(blockText(p.lookup)));
      expect(t.indexOf(blockText(p.lookup))).toBeLessThan(t.indexOf("\n---\n"));
      if (BUNDLED.verified === "partial") expect(t).toContain("부분 검증");
    }
    blocks.push(blockText(p.lookup));
  });

  it("several primaries in one code show at most three lines", () => {
    const g = sggWhere((x) => x.parent_code === undefined);
    const SYN = syntheticFile([
      fakeCenter(g.code, "보건소", 1),
      fakeCenter(g.code, "보건의료원", 2),
      fakeCenter(g.code, "보건소", 3),
      fakeCenter(g.code, "보건소", 4),
    ]);
    const s = section("pregnant", regionText(g), SYN);
    const h = asFound(s.healthCenter);
    expect(h.scope).toBe("sigungu");
    const lines = renderLocalSection(s)
      .split("\n")
      .filter((l) => l.startsWith("보건소 연락처("));
    expect(lines).toHaveLength(3);
    expect(lines).toEqual(h.centers.map((c) => contactText(c, SYN.as_of)));
    for (const c of h.centers) expect(c.name).toMatch(/^합성/);
    expect(s.basisIds.filter((id) => id === HEALTH_CENTER_BASIS_ID)).toHaveLength(1);
    blocks.push(blockText(h));
  });

  it("parent city and multiple cases", async () => {
    const g = sggWhere((x) => x.parent_code !== undefined);
    const parent = sggWhere((x) => x.code === g.parent_code);
    const SYN = syntheticFile([fakeCenter(g.parent_code!, "보건소", 1)]);
    const s = section("born", regionText(g), SYN);
    const h = asFound(s.healthCenter);
    expect(h.scope).toBe("parent-city");
    const t = renderLocalSection(s);
    expect(t).toContain(contactText(SYN.centers[0]!, SYN.as_of, "시 보건소, "));
    expect(t).toContain(healthCenterNotice(SYN.as_of));
    blocks.push(blockText(h));

    const SYN2 = syntheticFile([fakeCenter(g.code, "보건소", 1)]);
    const s2 = section("born", regionText(parent), SYN2);
    const u = s2.healthCenter;
    expect(u).toMatchObject({ kind: "unresolved", reason: "multiple" });
    if (u?.kind !== "unresolved") throw new Error("expected unresolved");
    expect(u.candidates).toContain(g.name);
    const t2 = renderLocalSection(s2);
    expect(t2).toContain(`보건소 연락처: ${HEALTH_CENTER_MULTIPLE}`);
    expect(t2).toContain(`후보: ${u.candidates.join(", ")}`);
    expect(t2).toContain(HEALTH_CENTER_UNRESOLVED_LINKS);
    expect(t2).toContain(LOCAL_SUPPORT_POINTER);
    expect(s2.basisIds).not.toContain(HEALTH_CENTER_BASIS_ID);
    blocks.push(blockText(u));

    const pc = pickRegion((l) => l.kind === "found" && l.scope === "parent-city");
    const mu = pickRegion((l) => l.kind === "unresolved" && l.reason === "multiple");
    expect(pc !== undefined || mu !== undefined).toBe(true);
    for (const pick of [pc, mu]) {
      if (pick === undefined) continue;
      const r = await call({ ...PREG, region: pick.text });
      expect(text(r)).toContain(blockText(pick.lookup));
      expect(countOf(text(r), BASIS)).toBe(pick === pc ? 1 : 0);
      blocks.push(blockText(pick.lookup));
    }
  });

  it("branch case lists up to three secondary institutions", () => {
    const g = sggWhere(branchOnly);
    const SYN = syntheticFile([1, 2, 3, 4].map((n) => fakeCenter(g.code, "보건지소", n)));
    const s = section("born", regionText(g), SYN);
    const h = asFound(s.healthCenter);
    expect(h.scope).toBe("branch");
    const lines = renderLocalSection(s).split("\n");
    const i = lines.findIndex((l) => l.startsWith("보건소 연락처("));
    expect(i).toBeGreaterThanOrEqual(0);
    expect(lines.slice(i, i + 6)).toEqual([
      ...h.centers.map((c) => contactText(c, SYN.as_of)),
      HEALTH_CENTER_BRANCH_NOTE,
      healthCenterNotice(SYN.as_of),
      LOCAL_SUPPORT_POINTER,
    ]);
    blocks.push(blockText(h));
  });

  it("merged and old province names resolve through the same path", async () => {
    const sido12 = loadData("regions").sido.find((s) => s.code === "12")!;
    expect(sido12.aliases).toContain("전라남도");
    expect(sido12.aliases).toContain("전남");
    const g12 = sggWhere((x) => x.sido_code === "12" && x.parent_code === undefined);
    const SYN = syntheticFile([fakeCenter(g12.code, "보건소", 1)]);
    for (const input of [`전라남도 ${g12.name}`, `전남 ${g12.name}`, regionText(g12)]) {
      const l = lookupHealthCenter(input, SYN);
      expect(l, input).toMatchObject({ kind: "found", scope: "sigungu" });
      expect(asFound(l).centers).toEqual([SYN.centers[0]]);
    }
    const b = pickRegion((l, g) => g.sido_code === "12" && g.parent_code === undefined && l.kind === "found");
    if (b !== undefined) {
      const r = await call({ ...PREG, region: `전라남도 ${b.sgg.name}` });
      expect(text(r)).toContain(blockText(b.lookup));
      blocks.push(blockText(b.lookup));
    }
  });

  it("region without a listed center shows the preparing message and links", async () => {
    const g = loadData("regions").sigungu[0]!;
    const s = section("pregnant", regionText(g), syntheticFile([]));
    const t = renderLocalSection(s);
    expect(t).toContain(`보건소 연락처: ${HEALTH_CENTER_PREPARING}`);
    expect(t).toContain(HEALTH_CENTER_UNRESOLVED_LINKS);
    expect(t).toContain(LOCAL_SUPPORT_POINTER);
    expect(t).not.toContain("후보:");
    blocks.push(blockText(s.healthCenter!));

    const pn = pickRegion((l) => l.kind === "unresolved" && l.reason === "none");
    if (pn !== undefined) {
      const r = await call({ ...PREG, region: pn.text });
      expect(text(r)).toContain(blockText(pn.lookup));
      expect(countOf(text(r), BASIS)).toBe(0);
      blocks.push(blockText(pn.lookup));
    }
  });

  it("province only or unknown region asks for the sigungu", async () => {
    for (const args of [PREG, BORN]) {
      const r1 = await call({ ...args, region: "경기도" });
      const t1 = text(r1);
      expect(r1.isError).toBeFalsy();
      expect(t1).toContain(`보건소 연락처: ${HEALTH_CENTER_SIDO_ONLY}`);
      expect(t1).toContain(HEALTH_CENTER_UNRESOLVED_LINKS);
      expect(t1).toContain(LOCAL_SUPPORT_POINTER);
      expect(countOf(t1, BASIS)).toBe(0);
      blocks.push(blockText(lookupHealthCenter("경기도")));

      const r2 = await call({ ...args, region: "가나다라마" });
      const t2 = text(r2);
      expect(r2.isError).toBeFalsy();
      expect(t2).toContain(`보건소 연락처: ${HEALTH_CENTER_REGION_HINT}`);
      expect(t2).toContain(HEALTH_CENTER_UNRESOLVED_LINKS);
      expect(t2).toContain(LOCAL_SUPPORT_POINTER);
      expect(t2).toContain("입력 지역: 가나다라마");
      expect(countOf(t2, BASIS)).toBe(0);
      blocks.push(blockText(lookupHealthCenter("가나다라마")));
    }
  });

  it("blocks are pure additions to the previous output", () => {
    const found = pickRegion((l) => l.kind === "found")!.text;
    const cases = [
      { ...PREG, region: found },
      { ...BORN, region: found },
      { ...PREG, region: "경기도" },
      { ...BORN, region: "가나다라마" },
    ];
    for (const args of cases) {
      const off = computeOfflineTimeline(args, TODAY);
      const { healthCenter, ...rest } = off.local;
      const prev = { ...rest, basisIds: rest.basisIds.filter((id) => id !== HEALTH_CENTER_BASIS_ID) };
      const prevRevs = resolveBasis(footerBasisIds(off.result, prev)).map(keylessStatus);
      const newRevs = resolveBasis(footerBasisIds(off.result, off.local)).map(keylessStatus);
      const base = renderTimeline(off.result, off.view, prev, prevRevs);
      expect(off.output.body, JSON.stringify(args)).toBe(base.body);
      let f = off.output.footer!.replace("\n" + blockText(healthCenter!), "");
      if (healthCenter!.kind === "found") {
        const doc = resolveBasis([HEALTH_CENTER_BASIS_ID])[0]!;
        f = f
          .replace("\n" + basisLine(doc) + "\n" + revisionLine(keylessStatus(doc)), "")
          .replace(revisionSummary(newRevs), revisionSummary(prevRevs));
      }
      expect(f, JSON.stringify(args)).toBe(base.footer);
    }
    expect(computeOfflineTimeline(PREG, TODAY).local.healthCenter).toBeUndefined();
    expect(localGuidance({ mode: "born", region: "   " }).healthCenter).toBeUndefined();
    expect(getTimelineTool.schema.safeParse({ ...PREG, region: "" }).success).toBe(false);
  });

  it("block is the same with and without a key and uses no network", async () => {
    const found = pickRegion((l) => l.kind === "found")!.text;
    const c0 = keyless();
    const c1 = keyed();
    const c2 = keyed();
    const t0 = text(await call({ ...PREG, region: found }, c0));
    const t1 = text(await call({ ...PREG, region: found }, c1));
    await call(PREG, c2);
    const bt = blockText(lookupHealthCenter(found));
    expect(t0).toContain(bt);
    expect(t1).toContain(bt);
    expect(c0.fetch).toHaveBeenCalledTimes(0);
    expect(c1.fetch.mock.calls.length).toBe(c2.fetch.mock.calls.length);
    expect(globalFetch).toHaveBeenCalledTimes(0);
  });

  it("long region outputs stay within the cap and keep the footer", async () => {
    const found = pickRegion((l) => l.kind === "found")!.text;

    const bornArgs = { ...BORN_MAX, region: found };
    const bornOut = await getTimelineTool.handler(getTimelineTool.schema.parse(bornArgs), keyless());
    const bornText = text(await call(bornArgs));
    expect(bornText.length).toBeLessThanOrEqual(MAX);
    expect(bornText).not.toContain("자 생략");
    expect(bornText.endsWith(bornOut.footer!)).toBe(true);
    expect(bornText).toContain(DISCLAIMER_MEDICAL_LEGAL);
    expect(bornText).toContain(NOTICE_SOURCE);

    const pregArgs = { ...PREG, ...MAXW, region: found };
    const pregOut = await getTimelineTool.handler(getTimelineTool.schema.parse(pregArgs), keyless());
    const pregText = text(await call(pregArgs));
    expect(pregText.length).toBeLessThanOrEqual(MAX);
    expect(pregText.endsWith(pregOut.footer!)).toBe(true);

    const off = computeOfflineTimeline(BORN_MAX, TODAY);
    const branchG = sggWhere(branchOnly);
    const primaryG = sggWhere((x) => x.parent_code === undefined);
    const worst = [
      { g: branchG, SYN: syntheticFile([1, 2, 3].map((n) => fakeCenter(branchG.code, "보건지소", n))) },
      { g: primaryG, SYN: syntheticFile([1, 2, 3].map((n) => fakeCenter(primaryG.code, "보건의료원", n))) },
    ];
    for (const { g, SYN } of worst) {
      const out = worstOutput(off, section("born", regionText(g), SYN));
      const t = finalize(out, MAX, []);
      expect(t.length).toBeLessThanOrEqual(MAX);
      expect(t).not.toContain("자 생략");
      expect(t.endsWith(out.footer!)).toBe(true);
    }

    const offFound = computeOfflineTimeline(bornArgs, TODAY);
    const low = await runTool({ ...getTimelineTool, maxChars: offFound.output.footer!.length + 400 }, bornArgs, keyless());
    const lowText = text(low);
    expect(low.isError).toBeFalsy();
    expect(lowText.endsWith(offFound.output.footer!)).toBe(true);
    expect(lowText).toContain("자 생략");
    expect(lowText).toContain(DISCLAIMER_MEDICAL_LEGAL);
    expect(lowText).toContain(NOTICE_SOURCE);
    expect(lowText).toContain(healthCenterNotice(BUNDLED.as_of));
    expect(lowText).toContain(LOCAL_SUPPORT_POINTER);
  });

  it("added wording is positive and makes no claims", () => {
    expect(blocks.length).toBeGreaterThanOrEqual(8);
    const extra = [
      LOCAL_SUPPORT_POINTER,
      HEALTH_CENTER_BRANCH_NOTE,
      HEALTH_CENTER_UNRESOLVED_LINKS,
      healthCenterNotice(BUNDLED.as_of),
    ];
    for (const s of [...blocks, ...extra]) {
      expect(s).not.toMatch(LOCAL_ASSERTIVE);
      expect(s).not.toMatch(NEGATIVE_STEM);
      expect(s).not.toMatch(/unofficial/i);
      expect(s).not.toContain(UNOFFICIAL_KO);
    }
    for (const b of blocks) {
      expect(b).toContain(LOCAL_SUPPORT_POINTER);
      if (b.includes("보건소 연락처(")) expect(b).toContain(`기준일 ${BUNDLED.as_of}`);
    }
    expect(LOCAL_SUPPORT_POINTER).not.toContain("DATA_GO_KR_SERVICE_KEY");
  });
});
