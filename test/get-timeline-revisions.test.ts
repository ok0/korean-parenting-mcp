import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../src/core/context.js";
import { runTool } from "../src/core/pipeline.js";
import { resolveBasis } from "../src/data-store/load.js";
import type { BasisDoc } from "../src/data-store/schema.js";
import { storedFields } from "../src/provenance/revision-check.js";
import { getTimelineTool } from "../src/tools/get-timeline.js";
import { DISCLAIMER_MEDICAL_LEGAL, NOTICE_UNOFFICIAL, NOTICE_VACCINATION_SCOPE } from "../src/tools/shared/format.js";
import { createTestContext } from "./helpers/context.js";
import { createLawMock, htmlRes, jsonRes, sameAsStored, type LawMock, type LawRoute } from "./helpers/law-mock.js";

const FAKE = "ab+c/d=e1";
const ENC = encodeURIComponent(FAKE);
const LIVE_ENV = { LAW_OC: FAKE };

const A = { reference_date: "2026-10-28", due_date: "2027-02-10", birth_order: 1, fetus_count: 1, region: "성동구" };
const B = { reference_date: "2026-10-28", birth_date: "2026-05-28" };
const MAX = { months_ahead: 156, include_past: true };

const text = (r: { content: { type: string; text?: string }[] }): string => r.content[0]!.text ?? "";

function body(t: string): string {
  return t.split("\n\n---\n")[0]!;
}

function footerOf(t: string): string {
  return t.slice(t.indexOf("\n\n---\n"));
}

function countOf(t: string, s: string): number {
  return t.split(s).length - 1;
}

function footerDocs(t: string): Map<string, string> {
  const lines = footerOf(t).split("\n");
  const out = new Map<string, string>();
  lines.forEach((line, i) => {
    const m = /^- \[([a-z0-9-]+)\]/.exec(line);
    if (m) out.set(m[1]!, lines[i + 1] ?? "");
  });
  return out;
}

function footerIds(t: string): string[] {
  return [...footerDocs(t).keys()];
}

function footerIdsOf(footer: string): string[] {
  return [...footer.matchAll(/^- \[([a-z0-9-]+)\]/gm)].map((m) => m[1]!);
}

function hasBaseline(doc: BasisDoc): boolean {
  return doc.law_api !== null && Object.keys(storedFields(doc.law_api)).length > 0;
}

function targetDocs(ids: readonly string[]): BasisDoc[] {
  return resolveBasis(ids).filter(hasBaseline);
}

function firstLawDoc(ids: readonly string[]): BasisDoc | undefined {
  return resolveBasis(ids).find((d) => d.law_api?.kind === "law" && d.law_api.mst !== undefined);
}

async function plainText(args: Record<string, unknown>): Promise<string> {
  return text(await runTool(getTimelineTool, args, createTestContext()));
}

function ctxWith(mock: { fetch: typeof fetch }, env: Record<string, string>, sink?: (line: string) => void): ToolContext {
  return { ...createTestContext({ env, sink }), fetch: mock.fetch };
}

function changedLaw(doc: BasisDoc): LawRoute {
  const key = doc.law_api;
  if (key?.kind !== "law" || key.mst === undefined) throw new Error("fixture: MST가 있는 법령 문서가 아님");
  const name = key.law_name;
  const mst = String(Number(key.mst) + 1);
  return (url) => {
    if (url.searchParams.get("target") !== "law" || url.searchParams.get("query") !== name) return undefined;
    return jsonRes({
      LawSearch: {
        totalCnt: "1",
        law: [
          {
            법령명한글: name,
            법령ID: key.law_id ?? "TEST-LAW-CHANGED",
            법령일련번호: mst,
            시행일자: "20260101",
            법령상세링크: `/DRF/lawService.do?OC=${ENC}&target=law&MST=${mst}&type=HTML`,
          },
        ],
      },
    });
  };
}

function changedAdmrul(doc: BasisDoc): LawRoute {
  const key = doc.law_api;
  if (key?.kind !== "admrul") throw new Error("fixture: 행정규칙 문서가 아님");
  const name = key.name;
  return (url) => {
    if (url.searchParams.get("target") !== "admrul" || url.searchParams.get("query") !== name) return undefined;
    return jsonRes({
      AdmRulSearch: {
        totalCnt: "1",
        admrul: [
          {
            행정규칙명: name,
            행정규칙ID: key.rule_id ?? "TEST-ADM-CHANGED",
            발령번호: "제2026-7호",
            상세링크: `/DRF/lawService.do?OC=${ENC}&target=admrul&ID=1`,
          },
        ],
      },
    });
  };
}

function changedMock(ids: readonly string[]): LawMock {
  const routes: LawRoute[] = [];
  const law = firstLawDoc(ids);
  if (law) routes.push(changedLaw(law));
  const adm = resolveBasis(ids).find((d) => d.id === "health-checkup-standard");
  if (adm) routes.push(changedAdmrul(adm));
  return createLawMock(...routes, sameAsStored(FAKE));
}

const serveLawStatus =
  (status: number): LawRoute =>
  (url) =>
    url.searchParams.get("target") === "law" ? new Response("", { status }) : undefined;

const UNAVAILABLE_PREFIX = /^  · 개정 확인: 개정 여부 확인 불가/;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("get_timeline revision status integration (mocked law.go.kr)", () => {
  it("stored-equal responses are confirmed", async () => {
    const t = text(await runTool(getTimelineTool, B, ctxWith(createLawMock(sameAsStored(FAKE)), LIVE_ENV)));
    let confirmed = 0;
    for (const [id, line] of footerDocs(t)) {
      const doc = resolveBasis([id])[0]!;
      if (doc.law_api === null) {
        expect(line).toContain("자동 확인 대상 아님");
      } else if (hasBaseline(doc)) {
        expect(line).toContain("원문 확인됨");
        confirmed += 1;
      } else {
        expect(line).toContain("개정 여부 확인 불가(비교 기준 미등록)");
      }
    }
    expect(t.split("개정 확인 요약:").length - 1).toBe(1);
    expect(confirmed).toBeGreaterThanOrEqual(1);
    const summary = /개정 확인 요약: 원문 확인 (\d+) \//.exec(t);
    expect(Number(summary?.[1])).toBeGreaterThanOrEqual(1);
  });

  it("changed responses warn with link and leave items untouched", async () => {
    for (const args of [A, B]) {
      const plain = await plainText(args);
      const ids = footerIds(plain);
      const law = firstLawDoc(ids);
      expect(law).toBeDefined();

      const t = text(await runTool(getTimelineTool, args, ctxWith(changedMock(ids), LIVE_ENV)));
      const docs = footerDocs(t);
      const expectChanged = (line: string | undefined): void => {
        expect(line).toContain("근거가 개정되었습니다. 원문을 확인하세요");
        expect(line).toContain("저장");
        expect(line).toContain("현재");
        expect(line).toContain(" 원문: https://www.law.go.kr/");
      };
      expectChanged(docs.get(law!.id));
      if (ids.includes("health-checkup-standard")) expectChanged(docs.get("health-checkup-standard"));
      expect(body(t)).toBe(body(plain));
    }
  });

  it("law.go.kr failures keep timeline intact", async () => {
    const plain = await plainText(B);
    const targets = targetDocs(footerIds(plain));
    expect(targets.length).toBeGreaterThan(0);

    const failing: Record<string, typeof fetch> = {
      "HTTP 500": (async () => new Response("", { status: 500 })) as typeof fetch,
      "network reject": (async () => {
        throw new TypeError("network");
      }) as typeof fetch,
      "HTML 200": (async () => htmlRes()) as typeof fetch,
      "empty body": (async () =>
        new Response("", { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch,
    };

    for (const [name, f] of Object.entries(failing)) {
      const r = await runTool(getTimelineTool, B, ctxWith({ fetch: f }, LIVE_ENV));
      expect(r.isError, name).toBeFalsy();
      const t = text(r);
      expect(t, name).toContain(DISCLAIMER_MEDICAL_LEGAL);
      expect(t, name).toContain(NOTICE_UNOFFICIAL);
      expect(body(t), name).toBe(body(plain));
      const docs = footerDocs(t);
      for (const doc of targets) {
        expect(docs.get(doc.id), `${name}: ${doc.id}`).toMatch(UNAVAILABLE_PREFIX);
      }
    }
  });

  it("deadline bounds response time", async () => {
    const hang = { fetch: (() => new Promise<Response>(() => {})) as unknown as typeof fetch };
    const ctx = ctxWith(hang, { LAW_OC: FAKE, KPM_LAW_TIMEOUT_MS: "500" });
    const targets = targetDocs(footerIds(await plainText(B)));
    expect(targets.length).toBeGreaterThan(0);

    const started = Date.now();
    const r = await runTool(getTimelineTool, B, ctx);
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(500 + 1000);
    expect(r.isError).toBeFalsy();
    const docs = footerDocs(text(r));
    for (const doc of targets) {
      expect(docs.get(doc.id), doc.id).toContain("개정 여부 확인 불가(확인 시간 초과)");
    }
  });

  it("partial failure keeps other documents confirmed", async () => {
    const mock = createLawMock(serveLawStatus(500), sameAsStored(FAKE));
    const t = text(await runTool(getTimelineTool, B, ctxWith(mock, LIVE_ENV)));
    const docs = footerDocs(t);
    let admrulSeen = 0;
    let lawSeen = 0;
    for (const doc of targetDocs(footerIds(t))) {
      if (doc.law_api?.kind === "admrul") {
        expect(docs.get(doc.id)).toContain("원문 확인됨");
        admrulSeen += 1;
      } else if (doc.law_api?.kind === "law") {
        expect(docs.get(doc.id)).toMatch(UNAVAILABLE_PREFIX);
        lawSeen += 1;
      }
    }
    expect(admrulSeen).toBeGreaterThan(0);
    expect(lawSeen).toBeGreaterThan(0);
  });

  it("keyless: no fetch in both modes, skipped wording", async () => {
    const spy = vi.fn(async () => jsonRes({ LawSearch: { totalCnt: "0" } }));
    vi.stubGlobal("fetch", spy);
    for (const args of [A, B]) {
      const t = text(await runTool(getTimelineTool, args, ctxWith({ fetch: spy as unknown as typeof fetch }, {})));
      const docs = footerDocs(t);
      for (const [id, line] of docs) {
        const doc = resolveBasis([id])[0]!;
        if (doc.law_api === null) expect(line).toContain("자동 확인 대상 아님");
        else expect(line).toContain("법제처 OC 미설정: 개정 여부 확인 생략");
      }
      expect(t).toMatch(/원문 확인 0 \/ 개정됨 0 \/ 확인 불가 0 \/ 생략 [1-9]\d*/);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("requests carry no user input and only footer docs", async () => {
    const forbidden = [
      "2027-02-10",
      "20270210",
      "2026-05-28",
      "20260528",
      "2026-10-28",
      "20261028",
      "성동구",
      encodeURIComponent("성동구"),
    ];
    for (const args of [A, B]) {
      const mock = createLawMock(sameAsStored(FAKE));
      const t = text(await runTool(getTimelineTool, args, ctxWith(mock, LIVE_ENV)));
      const names = new Set<string>();
      for (const doc of resolveBasis(footerIds(t))) {
        const key = doc.law_api as { law_name?: string; name?: string } | null;
        const n = key?.law_name ?? key?.name;
        if (n !== undefined) names.add(n);
      }
      expect(mock.urls.length).toBeGreaterThan(0);
      const queries: string[] = [];
      for (const u of mock.urls) {
        const url = new URL(u);
        expect(url.hostname).toBe("www.law.go.kr");
        const q = url.searchParams.get("query") ?? "";
        queries.push(q);
        expect(names.has(q)).toBe(true);
        for (const s of forbidden) expect(u).not.toContain(s);
      }
      if (args === B) expect(queries).not.toContain("모자보건법 시행규칙");
    }
  });

  it("truncated body keeps revision warnings in footer", async () => {
    const ids = footerIdsOf(footerOf(await plainText({ ...B, ...MAX })));
    const ctx = ctxWith(changedMock(ids), LIVE_ENV);
    const args = { ...B, ...MAX };
    const out = await getTimelineTool.handler(getTimelineTool.schema.parse(args), ctx);
    const r = await runTool({ ...getTimelineTool, maxChars: out.footer!.length + 400 }, args, ctx);

    expect(r.isError).toBeFalsy();
    const lt = text(r);
    expect(lt).toContain("자 생략");
    expect(lt).toContain("근거가 개정되었습니다");
    expect(lt).toContain(" 원문: https://www.law.go.kr/");
    expect(lt).toContain("개정 확인 요약:");
    expect(lt).toContain(DISCLAIMER_MEDICAL_LEGAL);
    expect(lt).toContain(NOTICE_UNOFFICIAL);
    expect(lt).toContain("공휴일: 번들(생성일");
    expect(countOf(lt, NOTICE_VACCINATION_SCOPE)).toBe(1);
    expect(lt).not.toContain("자동 확인은 아직 제공하지 않");
    expect(lt.endsWith(out.footer!)).toBe(true);
  });

  it("OC and inputs never logged or printed", async () => {
    const lines: string[] = [];
    for (const args of [A, B]) {
      const ids = footerIds(await plainText(args));
      const r = await runTool(getTimelineTool, args, ctxWith(changedMock(ids), LIVE_ENV, (l) => lines.push(l)));
      const t = text(r);
      for (const s of [FAKE, ENC, "OC="]) expect(t).not.toContain(s);
    }
    expect(lines.length).toBeGreaterThan(0);
    const logged = lines.join("");
    for (const s of [FAKE, ENC, "OC=", "2027-02-10", "20270210", "2026-05-28", "20260528", "성동구"]) {
      expect(logged).not.toContain(s);
    }
  });
});
