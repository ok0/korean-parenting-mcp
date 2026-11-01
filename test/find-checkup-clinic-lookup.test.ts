import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../src/core/context.js";
import { runTool } from "../src/core/pipeline.js";
import type { UpstreamGuard } from "../src/core/upstream-guard.js";
import { findCheckupClinicTool } from "../src/tools/find-checkup-clinic.js";
import { createTestContext } from "./helpers/context.js";
import { hangUntilAbort, xmlRes } from "./helpers/kasi-mock.js";
import { KEY_FORMS, nemcXml, TEST_KEY } from "./helpers/nemc-mock.js";
import { CLINIC_ASSERT, OFFICIAL_CLAIM_OUTPUT, matchedPatterns } from "./helpers/wording.js";

const fx = (name: string): string =>
  readFileSync(new URL(`./fixtures/data-go-kr/checkupClinic/${name}`, import.meta.url), "utf8");

function mockFetch(respond: (href: string, init?: RequestInit) => Response | Promise<Response>): {
  fetch: typeof fetch;
  urls: string[];
} {
  const urls: string[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    urls.push(href);
    return respond(href, init);
  }) as unknown as typeof fetch;
  return { fetch: fetchFn, urls };
}

function keyed(fetch: typeof globalThis.fetch, env: Record<string, string> = {}, sink?: (line: string) => void): ToolContext {
  return { ...createTestContext({ env: { DATA_GO_KR_SERVICE_KEY: TEST_KEY, ...env }, sink }), fetch };
}

function keyless(): ToolContext {
  return {
    ...createTestContext(),
    fetch: vi.fn(async () => {
      throw new Error("network disabled");
    }) as unknown as typeof fetch,
  };
}

const run = (args: Record<string, unknown>, ctx: ToolContext) => runTool(findCheckupClinicTool, args, ctx);
const text = (res: { content: { type: "text"; text: string }[] }): string => res.content[0]!.text;

const T = "2026-10-28";
const DJ = { region: "동작구", birth_date: "2026-05-28", today: T };

const bodyOf = (t: string): string => t.split("\n\n---\n")[0]!;
const footerOf = (t: string): string => t.split("\n\n---\n")[1] ?? "";
const guideTail = (t: string): string => bodyOf(t).slice(bodyOf(t).indexOf("[먼저 전화로 확인]"));
const causeLine = (t: string): string | undefined => t.split("\n").find((l) => l.startsWith("조회 안내:"));

function section(t: string, title: string): string[] {
  const lines = t.split("\n");
  const i = lines.findIndex((l) => l.startsWith(title));
  if (i < 0) return [];
  const out: string[] = [];
  for (const l of lines.slice(i + 1)) {
    if (l === "" || l.startsWith("영유아 ") || l.startsWith("[")) break;
    out.push(l);
  }
  return out;
}

const listed = (lines: string[], name: string): boolean =>
  lines.some((l) => l.startsWith(`- ${name}(`) || l === `- ${name}` || l.startsWith(`- ${name} ·`));

const INFANT_HEAD = "[영유아 건강검진 기관(";
const ORAL_HEAD = "[영유아 구강검진 기관(";

function synth(n: number, f: (i: number) => Record<string, string>): Record<string, string>[] {
  return Array.from({ length: n }, (_, i) => ({
    hmcNm: `검진기관${String(i).padStart(4, "0")}`,
    ykindnm: "의원",
    locAddr: `서울특별시 동작구 테스트로 ${i}`,
    hmcTelNo: "02-000-0000",
    cxVl: "126.9",
    cyVl: "37.5",
    grenChrgTypeCd: "1",
    ...f(i),
  }));
}

const RESULT = (code: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?><response><header><resultCode>${code}</resultCode><resultMsg>ERROR</resultMsg></header></response>`;

describe("find_checkup_clinic keyed lookup", () => {
  it("AC1 keyed lookup calls getRegnHmcList once per region", async () => {
    const m = mockFetch(() => xmlRes(fx("dongjak.xml")));
    const ctx = keyed(m.fetch);
    await run(DJ, ctx);
    expect(m.urls.length).toBe(1);
    const u = new URL(m.urls[0]!);
    expect(u.pathname.endsWith("/getRegnHmcList")).toBe(true);
    expect(u.searchParams.get("siDoCd")).toBe("11");
    expect(u.searchParams.get("siGunGuCd")).toBe("590");
    expect(u.searchParams.get("numOfRows")).toBe("1000");
    expect(u.searchParams.get("serviceKey")).toBe(TEST_KEY);
    await run(DJ, ctx);
    expect(m.urls.length).toBe(1);
  });

  it("AC1 maps a 구 region to its siDoCd and siGunGuCd on a fresh context", async () => {
    const m = mockFetch(() => xmlRes(fx("yeongtong.xml")));
    await run({ region: "수원시 영통구", today: T }, keyed(m.fetch));
    expect(m.urls.length).toBe(1);
    const u = new URL(m.urls[0]!);
    expect(u.searchParams.get("siDoCd")).toBe("41");
    expect(u.searchParams.get("siGunGuCd")).toBe("117");
  });

  it("AC2 output has lookup section, filters, provenance and unchanged guide", async () => {
    const m = mockFetch(() => xmlRes(fx("dongjak.xml")));
    const t = text(await run(DJ, keyed(m.fetch)));
    for (const s of [
      "[검진기관 조회 결과]",
      "영유아 건강검진 기관(3곳)",
      "영유아 구강검진 기관(2곳)",
      "중앙대학교병원(종합병원)",
      "주소 서울특별시 동작구 흑석로 102 (흑석동)",
      "전화 1800-1114",
      "국민건강보험공단 검진기관 찾기 조회(공공데이터포털)",
      "조회일 2026-10-28",
      "방문 전 전화로 확인",
    ]) {
      expect(t).toContain(s);
    }
    expect(t).not.toContain("데이터를 조회하지 않으며");

    const infant = section(t, INFANT_HEAD);
    const oral = section(t, ORAL_HEAD);
    const items = [...fx("dongjak.xml").matchAll(/<item>([\s\S]*?)<\/item>/g)].map((mt) => ({
      name: /<hmcNm>([^<]*)<\/hmcNm>/.exec(mt[1]!)![1]!,
      infant: /<ichkChrgTypeCd>([^<]*)<\/ichkChrgTypeCd>/.exec(mt[1]!)?.[1],
      oral: /<mchkChrgTypeCd>([^<]*)<\/mchkChrgTypeCd>/.exec(mt[1]!)?.[1],
    }));
    expect(items.length).toBe(5);
    for (const it of items) {
      expect(listed(infant, it.name)).toBe(it.infant === "1");
      expect(listed(oral, it.name)).toBe(it.oral === "1");
    }

    for (const s of ["126.96", "37.50", "cxVl", "ChrgTypeCd"]) expect(t).not.toContain(s);

    const keylessText = text(await run(DJ, keyless()));
    expect(guideTail(t)).toBe(guideTail(keylessText));

    expect(matchedPatterns(t, [CLINIC_ASSERT])).toEqual([]);
    expect(matchedPatterns(t, OFFICIAL_CLAIM_OUTPUT)).toEqual([]);
    expect(footerOf(t)).toContain("조회일 2026-10-28");
    expect(footerOf(t)).toContain("최종 확인");
  });

  it("AC2 synthetic 0/1/9/missing flags", async () => {
    const flags: Record<string, string>[] = [
      { ichkChrgTypeCd: "1", mchkChrgTypeCd: "9" },
      { ichkChrgTypeCd: "0", mchkChrgTypeCd: "1" },
      { ichkChrgTypeCd: "9", mchkChrgTypeCd: "0" },
      {},
    ];
    const m = mockFetch(() => xmlRes(nemcXml(synth(4, (i) => flags[i]!))));
    const t = text(await run(DJ, keyed(m.fetch)));
    const infant = section(t, INFANT_HEAD);
    const oral = section(t, ORAL_HEAD);
    expect(infant).toHaveLength(1);
    expect(infant[0]).toContain("검진기관0000");
    expect(oral).toHaveLength(1);
    expect(oral[0]).toContain("검진기관0001");
    expect(t).not.toContain("검진기관0002");
    expect(t).not.toContain("검진기관0003");
  });

  it("AC3 1000-row response caps and keeps order and footer", async () => {
    const items = synth(1000, (i) => ({
      ichkChrgTypeCd: i % 4 === 0 ? "1" : "0",
      mchkChrgTypeCd: i % 5 === 0 ? "1" : "9",
    }));
    const m = mockFetch(() => xmlRes(nemcXml(items, 1000)));
    const t = text(await run(DJ, keyed(m.fetch)));

    const infant = section(t, INFANT_HEAD);
    expect(t).toContain("[영유아 건강검진 기관(250곳)]");
    expect(infant).toHaveLength(11);
    expect(infant.slice(0, 10).map((l) => l.match(/검진기관\d{4}/)![0])).toEqual([
      "검진기관0000", "검진기관0004", "검진기관0008", "검진기관0012", "검진기관0016",
      "검진기관0020", "검진기관0024", "검진기관0028", "검진기관0032", "검진기관0036",
    ]);
    expect(infant[10]).toBe("- 외 240곳");

    const oral = section(t, ORAL_HEAD);
    expect(t).toContain("[영유아 구강검진 기관(200곳)]");
    expect(oral).toHaveLength(6);
    expect(oral.slice(0, 5).map((l) => l.match(/검진기관\d{4}/)![0])).toEqual([
      "검진기관0000", "검진기관0005", "검진기관0010", "검진기관0015", "검진기관0020",
    ]);
    expect(oral[5]).toBe("- 외 195곳");

    expect(t.length).toBeLessThanOrEqual(8000);
    expect(t).toContain("최종 확인");
    expect(t).toContain("의료 면책");
    expect(t).toContain("비공식 도구 고지");
  });

  it("AC3 total above the fetched rows shows the partial-check notice", async () => {
    const items = synth(1000, (i) => ({
      ichkChrgTypeCd: i % 4 === 0 ? "1" : "0",
      mchkChrgTypeCd: i % 5 === 0 ? "1" : "9",
    }));
    const m = mockFetch(() => xmlRes(nemcXml(items, 1500)));
    const t = text(await run(DJ, keyed(m.fetch)));
    expect(t).toContain("1500곳 중 앞 1000곳만 확인");
  });

  it("AC3 small response size keeps footer notices", async () => {
    const items = synth(1000, (i) => ({
      ichkChrgTypeCd: i % 4 === 0 ? "1" : "0",
      mchkChrgTypeCd: i % 5 === 0 ? "1" : "9",
    }));
    const m = mockFetch(() => xmlRes(nemcXml(items, 1000)));
    const t = text(await run(DJ, keyed(m.fetch, { KPM_MAX_RESPONSE_CHARS: "1000" })));
    expect(t.length).toBeLessThanOrEqual(1000);
    expect(t).toContain("최종 확인");
    expect(t).toContain("의료 면책");
    expect(t).toContain("비공식 도구 고지");
  });

  it("AC4 keyed without region makes no call and matches keyless output", async () => {
    const input = { birth_date: "2026-05-28", today: T };
    const m = mockFetch(() => xmlRes(fx("dongjak.xml")));
    const t = text(await run(input, keyed(m.fetch)));
    expect(m.urls.length).toBe(0);
    expect(t).toBe(text(await run(input, keyless())));
  });

  it("AC4 keyed with an unresolvable region makes no call and matches keyless output", async () => {
    const input = { region: "인천 서구", today: T };
    const m = mockFetch(() => xmlRes(fx("dongjak.xml")));
    const t = text(await run(input, keyed(m.fetch)));
    expect(m.urls.length).toBe(0);
    expect(t).toBe(text(await run(input, keyless())));
  });

  it("AC4 remote-style context (upstream set) makes no call and matches keyless output", async () => {
    const m = mockFetch(() => xmlRes(fx("dongjak.xml")));
    const stub = {
      admit: async () => {
        throw new Error("must not admit");
      },
      minTtl: () => 0,
      staleMaxMs: 0,
      markExhausted: async () => {},
      counts: async () => ({}) as never,
    };
    const ctx = { ...keyed(m.fetch), upstream: stub as unknown as UpstreamGuard };
    const t = text(await run(DJ, ctx));
    expect(m.urls.length).toBe(0);
    expect(t).toBe(text(await run(DJ, keyless())));
  });

  it("AC4 city-split region (수원시) makes no call and explains the cause", async () => {
    const m = mockFetch(() => xmlRes(fx("yeongtong.xml")));
    const res = await run({ region: "수원시", today: T }, keyed(m.fetch));
    const t = text(res);
    expect(m.urls.length).toBe(0);
    expect(res.isError).toBeFalsy();
    const cl = causeLine(t);
    expect(cl).toBeDefined();
    expect(cl!).toContain("구 단위로 나뉘어");
    expect(t).toContain("[링크]");
    expect(footerOf(t)).toContain("외부 호출 0회");
  });

  it("AC4 sido-only region (경기도) makes no call and explains the cause", async () => {
    const m = mockFetch(() => xmlRes(fx("yeongtong.xml")));
    const t = text(await run({ region: "경기도", today: T }, keyed(m.fetch)));
    expect(m.urls.length).toBe(0);
    expect(causeLine(t)).toContain("시군구까지 알려 주시면");
  });

  it("AC4 keyless seongdong output matches the committed snapshot", async () => {
    const t = text(await run({ region: "성동구", birth_date: "2026-05-28", today: T }, keyless()));
    await expect(t).toMatchFileSnapshot("./__snapshots__/find-checkup-clinic-seongdong.txt");
  });

  it("AC5 failures fall back without isError and with distinct causes", async () => {
    const cases: {
      name: string;
      respond: (href: string, init?: RequestInit) => Response | Promise<Response>;
      env?: Record<string, string>;
    }[] = [
      { name: "bad key", respond: () => xmlRes(fx("error-bad-key.xml"), 403) },
      { name: "not approved", respond: () => xmlRes(RESULT("20")) },
      { name: "daily limit", respond: () => xmlRes(RESULT("22")) },
      { name: "timeout", respond: (_h, init) => hangUntilAbort(init), env: { KPM_HTTP_TIMEOUT_MS: "1000" } },
      {
        name: "network",
        respond: () => {
          throw new TypeError("x");
        },
      },
      { name: "empty", respond: () => xmlRes(fx("empty.xml")) },
      {
        name: "none matched",
        respond: () => xmlRes(nemcXml(synth(3, () => ({ ichkChrgTypeCd: "0", mchkChrgTypeCd: "0" })))),
      },
    ];

    const normal = text(await run(DJ, keyless()));
    const causes: string[] = [];
    const logs: string[] = [];
    for (const c of cases) {
      const m = mockFetch(c.respond);
      const res = await run(DJ, keyed(m.fetch, c.env ?? {}, (l) => logs.push(l)));
      const t = text(res);
      expect(res.isError, c.name).toBeFalsy();
      expect(t, c.name).toContain("[링크]");
      expect(t, c.name).toContain("[먼저 전화로 확인]");
      expect(t, c.name).not.toContain("[검진기관 조회 결과]");
      const cl = causeLine(t);
      expect(cl, c.name).toBeDefined();
      causes.push(cl!);
      expect(guideTail(t), c.name).toBe(guideTail(normal));
      for (const k of KEY_FORMS) {
        expect(t, c.name).not.toContain(k);
      }
    }
    expect(new Set(causes).size).toBe(7);

    const allLogs = logs.join("\n");
    for (const k of KEY_FORMS) expect(allLogs).not.toContain(k);
    expect(allLogs).not.toContain("동작구");
    expect(allLogs).not.toContain("2026-05-28");
  }, 15000);
});
