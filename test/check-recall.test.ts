import { describe, expect, it } from "vitest";
import { SK_MAX_ROWS, SK_SPECS, type SkService } from "../src/clients/safetykorea.js";
import { CACHE_TTL_MS } from "../src/core/cache-ttl.js";
import { runTool } from "../src/core/pipeline.js";
import { checkRecallTool } from "../src/tools/check-recall.js";
import {
  ASSERTIVE_SAFETY,
  matchedPatterns,
  OFFICIAL_CLAIM_OUTPUT,
} from "./helpers/wording.js";
import {
  createSkMock,
  hangUntilAbort,
  SK_KEY_FORMS,
  SK_TEST_KEY,
  skBody,
  skCtx,
  skFx,
  skHtml,
  skJson,
  skRows,
  type SkRoute,
} from "./helpers/sk-mock.js";

const SERVICES: readonly SkService[] = ["recallList", "fRecallList", "overseasList", "certificationList"];
const FIXTURE_TOTAL = SERVICES.reduce((n, s) => n + skRows(s).length, 0);
const textOf = (res: { content: { type: "text"; text: string }[] }): string => res.content[0]!.text;
const run = (args: Record<string, unknown>, ctx: ReturnType<typeof skCtx>) => runTool(checkRecallTool, args, ctx);
const runText = async (args: Record<string, unknown>, ctx: ReturnType<typeof skCtx>): Promise<string> =>
  textOf(await run(args, ctx));
const R0 = skRows("recallList")[0]!;

describe("check_recall input", () => {
  it("limit accepts numeric string", async () => {
    const res = await run({ product_name: "유모차", limit: "2" }, skCtx(createSkMock()));
    const text = textOf(res);
    expect(res.isError).toBeFalsy();
    expect(text).toContain("1. ");
    expect(text).toContain("2. ");
    expect(text).not.toContain("3. ");
  });

  it("limit out of range, bad product_name and missing args are BAD_INPUT without fetch", async () => {
    const cases: Record<string, unknown>[] = [
      { product_name: "유모차", limit: 0 },
      { product_name: "유모차", limit: 11 },
      { product_name: "유모차", limit: "abc" },
      { product_name: "가" },
      { product_name: "가".repeat(51) },
      { product_name: "   " },
      {},
    ];
    for (const args of cases) {
      const mock = createSkMock();
      const res = await run(args, skCtx(mock));
      expect(res.isError).toBe(true);
      expect(textOf(res)).toContain("BAD_INPUT");
      expect(mock.calls.length).toBe(0);
    }
  });

  it("include_certification accepts the string true", async () => {
    const mock = createSkMock();
    const res = await run({ product_name: "유모차", include_certification: "true" }, skCtx(mock));
    expect(res.isError).toBeFalsy();
    expect(mock.count("certificationList")).toBe(1);
  });
});

describe("check_recall key and request", () => {
  it("no key: MISSING_KEY guidance and no fetch", async () => {
    const mock = createSkMock();
    const res = await run({ product_name: "유모차" }, skCtx(mock, { env: { SAFETYKOREA_AUTH_KEY: "" } }));
    const text = textOf(res);
    expect(res.isError).toBe(true);
    for (const w of ["SAFETYKOREA_AUTH_KEY", "신청", "승인", "AuthKey"]) expect(text).toContain(w);
    expect(mock.calls.length).toBe(0);
  });

  it("request: AuthKey header, product condition key, key never in URL", async () => {
    const mock = createSkMock();
    await run({ product_name: " 유모차 " }, skCtx(mock));
    expect(mock.calls.map((c) => c.service).sort()).toEqual(["fRecallList", "overseasList", "recallList"]);
    for (const c of mock.calls) {
      expect(Object.keys(c.headers ?? {})).toEqual(["AuthKey"]);
      expect(c.headers?.AuthKey).toBe(SK_TEST_KEY);
      expect(c.url.searchParams.get("conditionKey")).toBe(SK_SPECS[c.service].productKey);
      expect(c.url.searchParams.get("conditionValue")).toBe("유모차");
      const decoded = decodeURIComponent(c.url.href);
      for (const form of SK_KEY_FORMS) expect(decoded).not.toContain(form);
    }
  });

  it("request with include_certification calls four services", async () => {
    const mock = createSkMock();
    await run({ product_name: "유모차", include_certification: true }, skCtx(mock));
    expect(mock.calls.length).toBe(4);
    expect(mock.count("certificationList")).toBe(1);
  });
});

describe("check_recall summary", () => {
  it("fixture summary and snapshot", async () => {
    const args = { product_name: "유아", include_certification: true, limit: 10 };
    const first = await runText(args, skCtx(createSkMock()));
    const second = await runText(args, skCtx(createSkMock()));
    expect(second).toBe(first);
    await expect(first).toMatchFileSnapshot("./__snapshots__/check-recall-fixtures.txt");
    expect(first.indexOf("알칼리·망간 전지")).toBeLessThan(first.indexOf("유아용섬유제품"));
    expect(first.indexOf("유아용섬유제품")).toBeLessThan(first.indexOf("가정용섬유제품(책가방)"));
    expect(first.indexOf("가정용섬유제품(책가방)")).toBeLessThan(first.indexOf("뮤직박스완구"));
    expect(first).toContain("[국외 리콜] 뮤직박스완구 — 어린이제품 가능성(키워드)");
    expect(first).toContain("[해외직구 안전성조사] 알칼리·망간 전지(건전지) — 어린이제품 여부 불명");
    expect(first).toContain("사유·위해: 작은 부품");
    expect(first).toContain("조치: 수선 및 교환");
    expect(first).toContain("인증 상태: 적합");
    expect(first).toContain("키워드 기반");
    expect(first).toContain("인증 기록입니다");
    expect(first).toContain(`제품명 일치 ${FIXTURE_TOTAL}건`);
  });

  it("dedupe: same uid rows collapse and uid-less duplicates collapse", async () => {
    const r1 = skRows("recallList")[1]!;
    const routes: Partial<Record<SkService, SkRoute>> = {
      recallList: () => skJson(skBody("2000", [R0, R0, r1])),
      fRecallList: () => skJson(skBody("2004")),
      overseasList: () => skJson(skBody("2004")),
    };
    expect(await runText({ product_name: "유모차" }, skCtx(createSkMock(routes)))).toContain("제품명 일치 2건");

    const noUid: Record<string, unknown> = { ...R0 };
    delete noUid.recallUid;
    const uidless: Partial<Record<SkService, SkRoute>> = {
      recallList: () => skJson(skBody("2000", [noUid, { ...noUid }])),
      fRecallList: () => skJson(skBody("2004")),
      overseasList: () => skJson(skBody("2004")),
    };
    expect(await runText({ product_name: "유모차" }, skCtx(createSkMock(uidless)))).toContain("제품명 일치 1건");
  });

  it("partial: one service fails and the others are still shown", async () => {
    const mock = createSkMock({ overseasList: () => skJson(skFx("error-5000.json")) });
    const res = await run({ product_name: "유모차" }, skCtx(mock));
    const text = textOf(res);
    expect(res.isError).toBeFalsy();
    expect(text).toContain("일부 결과만 표시합니다");
    expect(text).toContain("해외직구 안전성조사 조회 실패");
    expect(text).toContain("5000");
    expect(text).toContain(String(R0.recallProductName));
  });

  it("all failed: distinct kinds and messages, three calls each", async () => {
    const cases: [string, () => Response, string[]][] = [
      ["4000", () => skJson(skFx("error-4000.json")), ["KEY_INVALID", "4000"]],
      ["4001", () => skJson(skFx("error-4001.json")), ["NOT_APPROVED", "승인 상태", "접속 정보(IP 등)"]],
      ["401", () => new Response("", { status: 401 }), ["KEY_INVALID", "HTTP 401"]],
      ["403", () => new Response("", { status: 403 }), ["KEY_INVALID", "HTTP 403"]],
      ["4005", () => skJson(skFx("error-4005.json")), ["UPSTREAM", "4005"]],
      ["5000", () => skJson(skFx("error-5000.json")), ["UPSTREAM", "5000"]],
      ["html", () => skHtml(), ["UPSTREAM", "HTML"]],
    ];
    const texts = new Map<string, string>();
    for (const [label, make, words] of cases) {
      const mock = createSkMock({ recallList: make, fRecallList: make, overseasList: make });
      const res = await run({ product_name: "유모차" }, skCtx(mock));
      const text = textOf(res);
      expect(res.isError).toBe(true);
      for (const w of words) expect(text).toContain(w);
      expect(mock.calls.length).toBe(3);
      texts.set(label, text);
    }
    expect(texts.get("4001")).not.toContain("고정 IP");
    expect(new Set(["4000", "4001", "5000", "html"].map((k) => texts.get(k))).size).toBe(4);
  });

  it("mixed all failed: the highest priority error wins", async () => {
    const mock = createSkMock({
      recallList: () => skJson(skFx("error-4000.json")),
      fRecallList: () => skJson(skFx("error-5000.json")),
      overseasList: () => skJson(skFx("error-5000.json")),
    });
    const res = await run({ product_name: "유모차" }, skCtx(mock));
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("KEY_INVALID");
  });

  it("zero results are not errors and point to the site", async () => {
    const empty = () => skJson(skFx("empty-2004.json"));
    const mock = createSkMock({ recallList: empty, fRecallList: empty, overseasList: empty });
    const res = await run({ product_name: "유모차" }, skCtx(mock));
    const text = textOf(res);
    expect(res.isError).toBeFalsy();
    for (const w of ["오류 아님", "안전하다는 뜻은 아닙니다", "제품명을 줄이거나", "https://www.safetykorea.kr"]) {
      expect(text).toContain(w);
    }
  });

  it("capped: upper bound notice", async () => {
    const rows = Array.from({ length: SK_MAX_ROWS }, (_, i) => ({ ...R0, recallUid: String(i) }));
    const mock = createSkMock({ recallList: () => skJson(skBody("2000", rows)) });
    const text = await runText({ product_name: "유모차" }, skCtx(mock));
    expect(text).toContain(`요청당 상한 ${SK_MAX_ROWS.toLocaleString("en-US")}건`);
    expect(text).toContain("제품명을 더 구체적으로");
  });

  it("large output keeps the footer within the size cap", async () => {
    const rows = Array.from({ length: SK_MAX_ROWS }, (_, i) => ({
      ...R0,
      recallUid: String(i),
      publishActionDscr: "가".repeat(500),
    }));
    const mock = createSkMock({ recallList: () => skJson(skBody("2000", rows)) });
    const res = await run(
      { product_name: "유모차", limit: 10 },
      skCtx(mock, { env: { KPM_MAX_RESPONSE_CHARS: "1500" } }),
    );
    const text = textOf(res);
    expect(text.length).toBeLessThanOrEqual(1500);
    expect(text).not.toContain("가".repeat(200));
    for (const w of ["출처:", "조회 시각", "공공기관이 제공하는 공개 API와 자료를 이용해 정리해 드려요.", "최종 확인"]) expect(text).toContain(w);
  });

  it("wording: success, zero, partial and capped outputs avoid assertive safety and official claims", async () => {
    const empty = () => skJson(skFx("empty-2004.json"));
    const outputs = [
      await runText({ product_name: "유아", include_certification: true, limit: 10 }, skCtx(createSkMock())),
      await runText(
        { product_name: "유모차" },
        skCtx(createSkMock({ recallList: empty, fRecallList: empty, overseasList: empty })),
      ),
      await runText(
        { product_name: "유모차" },
        skCtx(createSkMock({ overseasList: () => skJson(skFx("error-5000.json")) })),
      ),
      await runText(
        { product_name: "유모차" },
        skCtx(
          createSkMock({
            recallList: () =>
              skJson(skBody("2000", Array.from({ length: SK_MAX_ROWS }, (_, i) => ({ ...R0, recallUid: String(i) })))),
          }),
        ),
      ),
    ];
    for (const text of outputs) {
      expect(ASSERTIVE_SAFETY.test(text)).toBe(false);
      expect(matchedPatterns(text, OFFICIAL_CLAIM_OUTPUT)).toEqual([]);
    }
  });

  it("cache: normalized product name reuses results and TTL expiry refetches", async () => {
    let t = Date.parse("2026-10-28T21:30:00+09:00");
    const mock = createSkMock();
    const ctx = skCtx(mock, { now: () => new Date(t) });
    const counts = (n: number) => {
      for (const s of ["recallList", "fRecallList", "overseasList"] as const) expect(mock.count(s)).toBe(n);
    };
    await run({ product_name: "카시트" }, ctx);
    await run({ product_name: "  카시트 " }, ctx);
    counts(1);
    await run({ product_name: "유아 카시트" }, ctx);
    await run({ product_name: "유아  카시트" }, ctx);
    counts(2);
    t += CACHE_TTL_MS.recall + 60_000;
    await run({ product_name: "카시트" }, ctx);
    counts(3);
  });

  it("deadline: a hanging service becomes a partial failure within the chain deadline", async () => {
    const mock = createSkMock({ overseasList: (_, init) => hangUntilAbort(init) });
    const started = Date.now();
    const res = await run({ product_name: "유모차" }, skCtx(mock, { config: { chainDeadlineMs: 200 } }));
    expect(Date.now() - started).toBeLessThan(3000);
    expect(res.isError).toBeFalsy();
    expect(textOf(res)).toContain("해외직구 안전성조사 조회 실패");
  });

  it("never leaks key or input into output or logs", async () => {
    const logs: string[] = [];
    const sink = (l: string) => logs.push(l);
    const err4000 = () => skJson(skFx("error-4000.json"));
    const scenarios: [ReturnType<typeof skCtx>][] = [
      [skCtx(createSkMock(), { sink })],
      [skCtx(createSkMock({ recallList: err4000, fRecallList: err4000, overseasList: err4000 }), { sink })],
      [skCtx(createSkMock({ overseasList: () => skJson(skFx("error-5000.json")) }), { sink })],
      [skCtx(createSkMock(), { sink, env: { SAFETYKOREA_AUTH_KEY: "" } })],
    ];
    for (const [ctx] of scenarios) {
      logs.length = 0;
      const text = await runText({ product_name: "유모차" }, ctx);
      const all = [text, ...logs].join("\n");
      for (const form of SK_KEY_FORMS) expect(all).not.toContain(form);
      expect(logs.join("")).not.toContain("유모차");
    }
  });

  it("footer lists sources, the recall disclaimer and the source notice", async () => {
    const text = await runText({ product_name: "유모차" }, skCtx(createSkMock()));
    for (const w of [
      "제품안전정보센터(SafetyKorea) Open API",
      "국내 리콜정보",
      "조회 시각",
      "KST",
      "리콜 여부 판단",
      "공공기관이 제공하는 공개 API와 자료를 이용해 정리해 드려요.",
    ]) {
      expect(text).toContain(w);
    }
  });
});
