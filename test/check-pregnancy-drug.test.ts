import { describe, expect, it } from "vitest";
import { CACHE_TTL_MS } from "../src/core/cache-ttl.js";
import { DUR_NUM_OF_ROWS } from "../src/clients/data-go-kr-specs.js";
import { dataGoKrError } from "../src/core/errors.js";
import { runTool } from "../src/core/pipeline.js";
import { checkPregnancyDrugTool } from "../src/tools/check-pregnancy-drug.js";
import { DISCLAIMER_DRUG } from "../src/tools/shared/format.js";
import { KEY_FORMS, createDgkMock, dgkCtx, dgkFx, durXml, gatewayXml, xmlRes } from "./helpers/dgk-mock.js";

const run = (args: Record<string, unknown>, ctx: ReturnType<typeof dgkCtx>) => runTool(checkPregnancyDrugTool, args, ctx);
const textOf = (res: { content: { type: "text"; text: string }[] }): string => res.content[0]!.text;

const FORBIDDEN = /안전합니다|안전한 약|복용 가능|복용가능|먹어도|문제없|문제 없|등급/;
const NOTICE_NOT_FOUND = "DUR 임부금기 목록에서 이 이름을 찾지 못했습니다";
const SINGLE = dgkFx("durPregnancy/single.xml");
const matchAllValues = (xml: string, tag: string): string[] =>
  [...xml.matchAll(new RegExp(`<${tag}>(.*?)</${tag}>`, "g"))].map((m) => m[1]!);
const SINGLE_NAMES = matchAllValues(SINGLE, "ITEM_NAME");
const SINGLE_ENTPS = matchAllValues(SINGLE, "ENTP_NAME");
const SINGLE_INGRS = matchAllValues(SINGLE, "INGR_NAME");
const SINGLE_CONTENT = matchAllValues(SINGLE, "PROHBT_CONTENT")[0]!.replace(/\s+/g, " ").trim();
const SINGLE_TOTAL = Number(matchAllValues(SINGLE, "totalCount")[0]);
const SINGLE_ITEMS = (SINGLE.match(/<item>/g) ?? []).length;

const derived = (over: Record<string, string>): Record<string, string> => ({
  TYPE_NAME: "임부금기",
  INGR_NAME: "테스트성분",
  FORM_NAME: "정제",
  ITEM_SEQ: "900000001",
  ITEM_NAME: "파생정",
  ENTP_NAME: "파생제약",
  PROHBT_CONTENT: "임부에 대한 안전성 미확립.",
  ...over,
});

describe("check_pregnancy_drug input", () => {
  it("limit accepts numeric string", async () => {
    const res = await run({ drug_name: "아세트아미노펜", limit: "2" }, dgkCtx(createDgkMock()));
    const text = textOf(res);
    expect(res.isError).toBeFalsy();
    expect(text).toContain("1. ");
    expect(text).toContain("2. ");
    expect(text).not.toContain("3. ");
  });

  it("limit out of range is BAD_INPUT", async () => {
    for (const limit of [0, 11]) {
      const mock = createDgkMock();
      const res = await run({ drug_name: "아세트아미노펜", limit }, dgkCtx(mock));
      expect(res.isError).toBe(true);
      expect(textOf(res)).toContain("limit");
      expect(mock.urls.length).toBe(0);
    }
  });

  it("drug_name length and blank are BAD_INPUT", async () => {
    for (const args of [{ drug_name: "가" }, { drug_name: "가".repeat(51) }, { drug_name: "  " }, {}]) {
      const mock = createDgkMock();
      const res = await run(args, dgkCtx(mock));
      expect(res.isError).toBe(true);
      expect(mock.urls.length).toBe(0);
    }
  });
});

describe("check_pregnancy_drug summary", () => {
  it("single fixture summary", async () => {
    const res = await run({ drug_name: "아세트아미노펜" }, dgkCtx(createDgkMock()));
    const text = textOf(res);
    expect(res.isError).toBeFalsy();
    for (const v of [...SINGLE_NAMES, ...SINGLE_ENTPS, ...SINGLE_INGRS]) expect(text).toContain(v);
    expect(text).toContain(SINGLE_CONTENT.slice(0, 20));
    expect(text).toContain("금기 성분:");
    expect(text).toContain("복합제");
    expect(text).toContain(`일부만 조회됨: 전체 ${SINGLE_TOTAL}건 중 ${SINGLE_ITEMS}건`);
    expect(text).not.toMatch(FORBIDDEN);
  });

  it("request params", async () => {
    const mock = createDgkMock();
    await run({ drug_name: "아세트아미노펜" }, dgkCtx(mock));
    const url = mock.urls.at(-1)!;
    const expectedKeys = ["itemName", "serviceKey", ...(DUR_NUM_OF_ROWS !== undefined ? ["numOfRows"] : [])].sort();
    expect([...url.searchParams.keys()].sort()).toEqual(expectedKeys);
    expect(url.searchParams.get("itemName")).toBe("아세트아미노펜");
    expect(url.searchParams.has("_type")).toBe(false);
  });

  it("dedupe by ITEM_SEQ", async () => {
    const a = derived({ ITEM_SEQ: "900000001", ITEM_NAME: "가상정A" });
    const b = derived({ ITEM_SEQ: "900000002", ITEM_NAME: "가상정B" });
    const mock = createDgkMock({ dur: () => xmlRes(durXml([a, a, b], 3)) });
    const res = await run({ drug_name: "아세트아미노펜" }, dgkCtx(mock));
    const text = textOf(res);
    expect(text).toContain("1. ");
    expect(text).toContain("2. ");
    expect(text).not.toContain("3. ");
    expect(text).toContain("전체 후보 2건 모두 표시");
  });

  it("dedupe without ITEM_SEQ by name and maker", async () => {
    const noSeq = { TYPE_NAME: "임부금기", ITEM_NAME: "무시퀀스정", ENTP_NAME: "무시퀀스제약" };
    const mock = createDgkMock({ dur: () => xmlRes(durXml([noSeq, noSeq], 2)) });
    const res = await run({ drug_name: "아세트아미노펜" }, dgkCtx(mock));
    const text = textOf(res);
    expect(text).toContain("1. ");
    expect(text).not.toContain("2. ");
  });

  it("content clipped", async () => {
    const raw = "임".repeat(250) + "나".repeat(250);
    const mock = createDgkMock({ dur: () => xmlRes(durXml([derived({ PROHBT_CONTENT: raw })], 1)) });
    const res = await run({ drug_name: "아세트아미노펜" }, dgkCtx(mock));
    const text = textOf(res);
    expect(text).not.toContain(raw);
    expect(text).toContain("…");
  });

  it("json content-type with xml body", async () => {
    const mock = createDgkMock({
      dur: () => new Response(dgkFx("durPregnancy/json.xml"), { headers: { "content-type": "application/json" } }),
    });
    const res = await run({ drug_name: "아세트아미노펜" }, dgkCtx(mock));
    expect(res.isError).toBeFalsy();
    expect(textOf(res)).toContain(SINGLE_NAMES[0]!);
  });

  it("single item and missing fields", async () => {
    const mock = createDgkMock({ dur: () => xmlRes(durXml([{ ITEM_SEQ: "1", ITEM_NAME: "파생정" }], 1)) });
    const res = await run({ drug_name: "아세트아미노펜" }, dgkCtx(mock));
    const text = textOf(res);
    expect(res.isError).toBeFalsy();
    expect(text).toContain("파생정");
    expect(text).toContain("업체 정보 없음");
    expect(text).toContain("응답에 기재 없음");
  });
});

describe("check_pregnancy_drug disclaimer and zero results", () => {
  it("disclaimer everywhere", async () => {
    const scenarios = [
      createDgkMock(),
      createDgkMock({ dur: () => xmlRes(dgkFx("durPregnancy/empty.xml")) }),
      createDgkMock({ dur: () => xmlRes(dgkFx("durPregnancy/tylenol-0.xml")) }),
      createDgkMock({ dur: () => xmlRes(durXml([derived({})], 1)) }),
    ];
    for (const mock of scenarios) {
      const res = await run({ drug_name: "아세트아미노펜" }, dgkCtx(mock));
      const text = textOf(res);
      expect(text).toContain(DISCLAIMER_DRUG);
      expect(text).toContain("의료진·약사");
      expect(text).toContain("목록에 없다는 것이 안전하다는 뜻은 아닙니다");
      expect(text).not.toMatch(FORBIDDEN);
    }
    expect(DISCLAIMER_DRUG).not.toMatch(FORBIDDEN);
  });

  it("zero results", async () => {
    for (const rel of ["durPregnancy/empty.xml", "durPregnancy/tylenol-0.xml"]) {
      const mock = createDgkMock({ dur: () => xmlRes(dgkFx(rel)) });
      const res = await run({ drug_name: "아세트아미노펜" }, dgkCtx(mock));
      const text = textOf(res);
      expect(res.isError).toBeFalsy();
      expect(text).toContain("오류 아님");
      expect(text).toContain("성분명");
      expect(text).toContain("약사");
      expect(text).toContain(NOTICE_NOT_FOUND);
    }
  });
});

describe("check_pregnancy_drug cache and errors", () => {
  it("cache 7 days", async () => {
    let t = Date.parse("2026-10-28T21:30:00+09:00");
    const mock = createDgkMock();
    const ctx = dgkCtx(mock, { now: () => new Date(t) });
    await run({ drug_name: "아세트아미노펜" }, ctx);
    await run({ drug_name: "  아세트아미노펜 " }, ctx);
    expect(mock.count("dur")).toBe(1);
    await run({ drug_name: "이부프로펜" }, ctx);
    expect(mock.count("dur")).toBe(2);
    t += CACHE_TTL_MS.dur + 60_000;
    await run({ drug_name: "아세트아미노펜" }, ctx);
    expect(mock.count("dur")).toBe(3);
  });

  it.each(["20", "22", "23", "30", "31"])("error code %s", async (code) => {
    const mock = createDgkMock({ dur: () => xmlRes(gatewayXml(code)) });
    const res = await run({ drug_name: "아세트아미노펜" }, dgkCtx(mock));
    const text = textOf(res);
    const err = dataGoKrError(code);
    expect(res.isError).toBe(true);
    expect(text).toContain(err.message);
    expect(text).toContain(err.actions[0]!);
  });

  it("no key", async () => {
    const mock = createDgkMock();
    const res = await run({ drug_name: "아세트아미노펜" }, dgkCtx(mock, { env: { DATA_GO_KR_SERVICE_KEY: "" } }));
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("DATA_GO_KR_SERVICE_KEY");
    expect(mock.urls.length).toBe(0);
  });

  it("footer", async () => {
    const res = await run({ drug_name: "아세트아미노펜" }, dgkCtx(createDgkMock()));
    const text = textOf(res);
    expect(text).toContain("식품의약품안전처");
    expect(text).toContain("조회 시각");
    expect(text).toContain("공공기관이 제공하는 공개 API와 자료를 이용해 정리해 드려요.");
  });

  it("never leaks key", async () => {
    const scenarios = [
      { dur: undefined },
      { dur: () => xmlRes(dgkFx("durPregnancy/empty.xml")) },
      { dur: () => xmlRes(gatewayXml("30")) },
    ];
    for (const routes of scenarios) {
      const lines: string[] = [];
      const mock = createDgkMock(routes);
      const res = await run({ drug_name: "아세트아미노펜" }, dgkCtx(mock, { sink: (l) => lines.push(l) }));
      const all = textOf(res) + "\n" + lines.join("\n");
      for (const form of KEY_FORMS) expect(all).not.toContain(form);
    }
  });
});
