import { describe, expect, it } from "vitest";
import { BENEFITS_CONCURRENCY, BENEFITS_PER_PAGE, SPECS } from "../src/clients/data-go-kr-specs.js";
import { runTool } from "../src/core/pipeline.js";
import { findBenefitsTool } from "../src/tools/find-benefits.js";
import {
  type BenefitsRoute,
  KEY_FORMS,
  benefitRow,
  createDgkMock,
  dgkCtx,
  dgkFx,
  hangUntilAbort,
  jsonRes,
  pagedBenefits,
} from "./helpers/dgk-mock.js";

const run = (args: Record<string, unknown>, ctx: ReturnType<typeof dgkCtx>) => runTool(findBenefitsTool, args, ctx);
const textOf = (res: { content: { type: "text"; text: string }[] }): string => res.content[0]!.text;

const D1 = benefitRow({
  서비스ID: "D1",
  서비스명: "[성동구]임신부 교통비 지원",
  소관기관명: "서울특별시 성동구",
  서비스분야: "임신·출산",
  등록일시: "20240301000000",
});
const D2 = benefitRow({ 서비스ID: "D2", 서비스명: "출산축하금", 소관기관명: "서울특별시 강남구", 등록일시: "20240302000000" });
const D3 = benefitRow({ 서비스ID: "D3", 서비스명: "산후조리비 지원", 소관기관명: "부산광역시 중구", 등록일시: "20240303000000" });
const D4 = benefitRow({
  서비스ID: "D4",
  서비스명: "첫만남이용권",
  소관기관명: "보건복지부",
  서비스목적요약: "출생 아동에게 첫만남 이용권 지급",
  서비스분야: "생활지원",
  등록일시: "20240304000000",
});
const D5 = benefitRow({
  서비스ID: "D5",
  서비스명: "영유아 건강검진",
  소관기관명: "보건복지부",
  서비스분야: "보건·의료",
  등록일시: "20240305000000",
});
const D6 = benefitRow({
  서비스ID: "D6",
  서비스명: "어린이집 보육료 지원",
  소관기관명: "서울특별시",
  부서명: "보육정책과",
  등록일시: "20240306000000",
});
const D7 = benefitRow({
  서비스ID: "D7",
  서비스명: "난임부부 시술비 지원",
  소관기관명: "",
  부서명: "강남구 보건소",
  등록일시: "20240307000000",
});
const D8 = benefitRow({ 서비스ID: "D8", 서비스명: "청년 월세 지원", 소관기관명: "국토교통부", 등록일시: "20240308000000" });
const DERIVED = [D1, D2, D3, D4, D5, D6, D7, D8];

const DERIVED_TOTAL = DERIVED.length;
const TWO_FULL_PAGES_TOTAL = 2 * BENEFITS_PER_PAGE + 2;

describe("find_benefits input", () => {
  it("limit accepts numeric string", async () => {
    const res = await run({ limit: "2" }, dgkCtx(createDgkMock({ benefits: pagedBenefits([DERIVED]) })));
    const text = textOf(res);
    expect(res.isError).toBeFalsy();
    expect(text).toContain("1. ");
    expect(text).toContain("2. ");
    expect(text).not.toContain("3. ");
  });

  it("limit out of range is BAD_INPUT", async () => {
    for (const limit of [0, 11]) {
      const mock = createDgkMock();
      const res = await run({ limit }, dgkCtx(mock));
      expect(res.isError).toBe(true);
      expect(textOf(res)).toContain("limit");
      expect(mock.urls.length).toBe(0);
    }
  });

  it("keyword length out of range is BAD_INPUT", async () => {
    const mock = createDgkMock();
    const res = await run({ keyword: "가".repeat(31) }, dgkCtx(mock));
    expect(res.isError).toBe(true);
    expect(mock.urls.length).toBe(0);
  });

  it("invalid stage is BAD_INPUT", async () => {
    const mock = createDgkMock();
    const res = await run({ stage: "baby" }, dgkCtx(mock));
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("stage");
    expect(mock.urls.length).toBe(0);
  });

  it("region too long is BAD_INPUT", async () => {
    const mock = createDgkMock();
    const res = await run({ region: "가".repeat(41) }, dgkCtx(mock));
    expect(res.isError).toBe(true);
    expect(mock.urls.length).toBe(0);
  });
});

describe("find_benefits stage and keyword filters", () => {
  it("stage pregnancy keeps pregnancy rows only", async () => {
    const res = await run({ stage: "pregnancy", limit: 10 }, dgkCtx(createDgkMock({ benefits: pagedBenefits([DERIVED]) })));
    const text = textOf(res);
    expect(text).toContain("[성동구]임신부 교통비 지원");
    expect(text).toContain("난임부부 시술비 지원");
    expect(text).not.toContain("출산축하금");
    expect(text).not.toContain("청년 월세 지원");
  });

  it("stage birth keeps birth rows and drops infant-only rows", async () => {
    const res = await run({ stage: "birth", limit: 10 }, dgkCtx(createDgkMock({ benefits: pagedBenefits([DERIVED]) })));
    const text = textOf(res);
    expect(text).toContain("출산축하금");
    expect(text).toContain("산후조리비 지원");
    expect(text).toContain("첫만남이용권");
    expect(text).not.toContain("영유아 건강검진");
  });

  it("stage infant keeps infant rows and drops pregnancy-only rows", async () => {
    const res = await run({ stage: "infant", limit: 10 }, dgkCtx(createDgkMock({ benefits: pagedBenefits([DERIVED]) })));
    const text = textOf(res);
    expect(text).toContain("영유아 건강검진");
    expect(text).toContain("어린이집 보육료 지원");
    expect(text).not.toContain("[성동구]임신부 교통비 지원");
  });

  it("stage all (default) drops only the unmatched row", async () => {
    const res = await run({ limit: 10 }, dgkCtx(createDgkMock({ benefits: pagedBenefits([DERIVED]) })));
    const text = textOf(res);
    for (const row of DERIVED.slice(0, -1)) {
      expect(text).toContain(row.서비스명 as string);
    }
    expect(text).not.toContain("청년 월세 지원");
    expect(text).toContain(`전체 후보 ${DERIVED_TOTAL - 1}건 모두 표시`);
  });

  it("keyword requires a single matching term", async () => {
    const res = await run({ keyword: "첫만남", limit: 10 }, dgkCtx(createDgkMock({ benefits: pagedBenefits([DERIVED]) })));
    const text = textOf(res);
    expect(text).toContain("첫만남이용권");
    expect(text).not.toContain("출산축하금");
  });

  it("keyword with several terms requires all of them together with stage", async () => {
    const res = await run(
      { keyword: "첫만남 이용권", stage: "pregnancy" },
      dgkCtx(createDgkMock({ benefits: pagedBenefits([DERIVED]) })),
    );
    expect(res.isError).toBeFalsy();
    expect(textOf(res)).toContain("조건 일치 0건");
  });

  it("real fixture rows: pregnancy matches the 난임 row and not the 장려금 row", async () => {
    const res = await run({ stage: "pregnancy" }, dgkCtx(createDgkMock()));
    const text = textOf(res);
    expect(text).toContain("[성북구]난임부부 약제비 지원");
    expect(text).not.toContain("근로·자녀장려금");
  });
});

describe("find_benefits summary fields and request", () => {
  it("summary block lists field, target, summary, issuer and link", async () => {
    const res = await run({ limit: 10 }, dgkCtx(createDgkMock({ benefits: pagedBenefits([DERIVED]) })));
    const text = textOf(res);
    expect(text).toContain("첫만남이용권 [생활지원]");
    expect(text).toContain("   대상: 개인");
    expect(text).toContain("   요약: 출생 아동에게 첫만남 이용권 지급");
    expect(text).toContain("   신청처: 보건복지부");
    expect(text).toContain("https://www.gov.kr/portal/rcvfvrSvc/dtlEx/D4");
  });

  it("request params carry only page and perPage plus the key", async () => {
    const mock = createDgkMock();
    await run({ keyword: "첫만남", region: "성동구", stage: "birth" }, dgkCtx(mock));
    expect(mock.urls.length).toBeGreaterThan(0);
    for (const url of mock.urls) {
      expect([...url.searchParams.keys()].sort()).toEqual(["page", "perPage", "serviceKey"]);
      expect(url.searchParams.get("perPage")).toBe(String(BENEFITS_PER_PAGE));
      const decoded = decodeURIComponent(url.href);
      expect(decoded).not.toContain("첫만남");
      expect(decoded).not.toContain("성동구");
      expect(url.searchParams.has("cond")).toBe(false);
    }
  });

  it("deterministic snapshot for seongdong", async () => {
    const once = async () =>
      textOf(await run({ stage: "all", region: "성동구", limit: 10 }, dgkCtx(createDgkMock({ benefits: pagedBenefits([DERIVED]) }))));
    const first = await once();
    const second = await once();
    expect(second).toBe(first);
    await expect(first).toMatchFileSnapshot("./__snapshots__/find-benefits-seongdong.txt");
  });
});

describe("find_benefits region", () => {
  it("region classes: local first, national marked, other excluded", async () => {
    const res = await run({ region: "성동구", limit: 10 }, dgkCtx(createDgkMock({ benefits: pagedBenefits([DERIVED]) })));
    const text = textOf(res);
    expect(res.isError).toBeFalsy();
    const lineWith = (name: string): string => text.split("\n").find((l) => l.includes(`${name} [`)) ?? "";
    expect(lineWith("[성동구]임신부 교통비 지원")).toContain("해당 지역");
    expect(lineWith("어린이집 보육료 지원")).toContain("해당 지역");
    expect(lineWith("첫만남이용권")).toContain("전국/기타");
    expect(text).not.toContain("출산축하금");
    expect(text).not.toContain("산후조리비 지원");
    expect(text).not.toContain("난임부부 시술비 지원");
    const first = text.split("\n").find((l) => l.startsWith("1. ")) ?? "";
    expect(first).toContain("해당 지역");
    expect(text).toContain("지역 구분:");
  });

  it("sido-only region is accepted", async () => {
    const res = await run({ region: "경기도" }, dgkCtx(createDgkMock({ benefits: pagedBenefits([DERIVED]) })));
    expect(res.isError).toBeFalsy();
  });

  it.each([
    ["중구", "서울특별시 중구"],
    ["인천 서구", "폐지"],
    ["성수동", "구 단위로 입력"],
  ])("region guidance for %s makes no fetch", async (input, expected) => {
    const mock = createDgkMock();
    const res = await run({ region: input }, dgkCtx(mock));
    expect(res.isError).toBeFalsy();
    expect(textOf(res)).toContain(expected);
    expect(mock.urls.length).toBe(0);
  });
});

describe("find_benefits pages and cache", () => {
  const threePages = [
    [D1, D2],
    [D3, D4],
    [D5, D6],
  ];

  it("fetches all pages once and reuses the slim cache", async () => {
    let t = Date.parse("2026-10-28T21:30:00+09:00");
    const mock = createDgkMock({ benefits: pagedBenefits(threePages) });
    const ctx = dgkCtx(mock, { now: () => new Date(t) });
    await run({ limit: 10 }, ctx);
    expect([...mock.pages()].sort()).toEqual([1, 2, 3]);

    const before = mock.urls.length;
    await run({ stage: "birth", region: "성동구", keyword: "출산" }, ctx);
    expect(mock.urls.length).toBe(before);

    t += SPECS.benefitsList.cacheTtlMs + 60_000;
    await run({ limit: 10 }, ctx);
    expect(mock.urls.length).toBe(before + 3);
  });

  it("never runs more than BENEFITS_CONCURRENCY page requests at once", async () => {
    const pages = Array.from({ length: 6 }, (_, i) => [benefitRow({ 서비스ID: `P${i}`, 서비스명: `임신 지원 ${i}` })]);
    const inner = pagedBenefits(pages);
    let active = 0;
    let max = 0;
    const slow: BenefitsRoute = async (page, url, init) => {
      active++;
      max = Math.max(max, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return inner(page, url, init);
    };
    const mock = createDgkMock({ benefits: slow });
    const res = await run({ limit: 10 }, dgkCtx(mock));
    expect(res.isError).toBeFalsy();
    expect(max).toBeLessThanOrEqual(BENEFITS_CONCURRENCY);
    expect([...mock.pages()].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("partial page failure is reported and only the failed page is refetched", async () => {
    const inner = pagedBenefits([[D1], [D2], [D3]], TWO_FULL_PAGES_TOTAL);
    let healthy = false;
    const flaky: BenefitsRoute = (page, url, init) => {
      if (!healthy && page === 2) return new Response("err", { status: 500 });
      return inner(page, url, init);
    };
    const mock = createDgkMock({ benefits: flaky });
    const ctx = dgkCtx(mock);
    const res = await run({ limit: 10 }, ctx);
    const text = textOf(res);
    expect(res.isError).toBeFalsy();
    expect(text).toContain(`일부만 조회됨: 전체 ${TWO_FULL_PAGES_TOTAL}건 중`);
    expect(text).toContain("잠시 후 다시 조회");

    healthy = true;
    const beforeRetry = mock.pages().length;
    await run({ limit: 10 }, ctx);
    expect(mock.pages().slice(beforeRetry)).toEqual([2]);
  });

  it("chain deadline bounds a hanging page and reports partial results", async () => {
    const inner = pagedBenefits([[D1], [D2], [D3]], 3 * BENEFITS_PER_PAGE);
    const hang: BenefitsRoute = (page, url, init) => (page === 3 ? hangUntilAbort(init) : inner(page, url, init));
    const started = Date.now();
    const res = await run({ limit: 10 }, dgkCtx(createDgkMock({ benefits: hang }), { config: { chainDeadlineMs: 200 } }));
    expect(Date.now() - started).toBeLessThan(3000);
    expect(res.isError).toBeFalsy();
    const text = textOf(res);
    expect(text).toContain("일부만 조회됨");
    expect(text).toContain("시간 초과");
  });

  it("first page failure with bad key is an error", async () => {
    const mock = createDgkMock({ benefits: () => jsonRes(dgkFx("benefitsList/error-bad-key.json"), 401) });
    const res = await run({}, dgkCtx(mock));
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("KEY_INVALID");
  });

  it("first page failure with unknown code is an error", async () => {
    const mock = createDgkMock({ benefits: () => jsonRes('{"code":-99,"msg":"x"}', 500) });
    const res = await run({}, dgkCtx(mock));
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("-99");
  });
});

describe("find_benefits large result, zero results, footer", () => {
  it("large result is capped to the response size and keeps the footer", async () => {
    const many = Array.from({ length: 400 }, (_, i) => benefitRow({ 서비스ID: `G${i}`, 서비스명: `임신 지원 ${i}` }));
    const res = await run(
      { limit: 10 },
      dgkCtx(createDgkMock({ benefits: pagedBenefits([many]) }), { env: { KPM_MAX_RESPONSE_CHARS: "1500" } }),
    );
    const text = textOf(res);
    expect(text.length).toBeLessThanOrEqual(1500);
    expect(text).toContain("자 생략");
    expect(text).toContain("출처:");
    expect(text).toContain("조회 시각");
    expect(text).toContain("최종 확인");
    expect(text).toContain("공공기관이 제공하는 공개 API와 자료를 이용해 정리해 드려요.");
    expect(text).toContain("조건 일치 400건");
  });

  it("zero results is not an error and suggests next steps", async () => {
    const res = await run({ keyword: "없는검색어" }, dgkCtx(createDgkMock()));
    const text = textOf(res);
    expect(res.isError).toBeFalsy();
    expect(text).toContain("(정상 조회)");
    expect(text).toContain("stage");
    expect(text).toContain("정부24");
    expect(text).toContain("복지로");
  });

  it("footer carries source, time, notices and the no-apply statement", async () => {
    const text = textOf(await run({ limit: 10 }, dgkCtx(createDgkMock())));
    expect(text).toContain("행정안전부");
    expect(text).toContain("조회 시각");
    expect(text).toContain("최종 확인");
    expect(text).toContain("신청을 대행하지 않습니다");
    expect(text).toContain("공공기관이 제공하는 공개 API와 자료를 이용해 정리해 드려요.");
    expect(text).toContain("관련이 적은 서비스가 섞일 수 있습니다");
    expect(text).not.toContain("무관");
  });
});

describe("find_benefits key handling", () => {
  it("missing key makes no fetch and names the env var", async () => {
    const mock = createDgkMock();
    const res = await run({}, dgkCtx(mock, { env: { DATA_GO_KR_SERVICE_KEY: "" } }));
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("DATA_GO_KR_SERVICE_KEY");
    expect(mock.urls.length).toBe(0);
  });

  it("never leaks the key in output or logs", async () => {
    const lines: string[] = [];
    const sink = (line: string) => lines.push(line);
    const scenarios = [
      createDgkMock(),
      createDgkMock({ benefits: pagedBenefits([[D1], [D2]], TWO_FULL_PAGES_TOTAL) }),
      createDgkMock({ benefits: () => jsonRes(dgkFx("benefitsList/error-bad-key.json"), 401) }),
    ];
    for (const mock of scenarios) {
      const text = textOf(await run({ limit: 10 }, dgkCtx(mock, { sink })));
      for (const form of KEY_FORMS) {
        expect(text).not.toContain(form);
        expect(lines.join("\n")).not.toContain(form);
      }
    }
  });
});
