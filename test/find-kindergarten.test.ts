import { describe, expect, it } from "vitest";
import type { ToolContext } from "../src/core/context.js";
import { runTool } from "../src/core/pipeline.js";
import { findKindergartenTool } from "../src/tools/find-kindergarten.js";
import {
  KG_KEY_FORMS,
  KG_PATH,
  createKgMock,
  kgBody,
  kgCtx,
  kgFx,
  kgMany,
  kgRes,
  type KgMock,
} from "./helpers/kg-mock.js";
import { KINDERGARTEN_ASSERT, OFFICIAL_CLAIM_OUTPUT, matchedPatterns } from "./helpers/wording.js";

const DONGMYEONG = "서울동명초등학교병설유치원";
const GYEONGIL = "서울경일초등학교병설유치원";
const ROSA = "로사유치원";
const GEUMHO = "서울금호초등학교병설유치원";
const MAJANG = "서울마장초등학교병설유치원";
const BASE_ORDER = [DONGMYEONG, GYEONGIL, ROSA, GEUMHO, MAJANG];
const AGE3_ORDER = [DONGMYEONG, GEUMHO, ROSA, MAJANG, GYEONGIL];

const ZERO_TEXT = "해당 시군구에 조회된 유치원 없음 또는 공시 차수 부재(오류 아님).";
const SUCCESS_NOTICES = [
  "공시 기준 추정치",
  "실시간 모집·대기 현황이 아닙니다",
  "출처: 유치원알리미",
  "조회 시각 2026-10-28 21:30 KST",
  "공공기관이 제공하는 공개 API와 자료를 이용해 정리해 드려요.",
  "유치원·교육청·유치원알리미에서 확인",
];

async function run(args: Record<string, unknown>, ctx: ToolContext = kgCtx(createKgMock())) {
  const res = await runTool(findKindergartenTool, args, ctx);
  return { text: res.content[0]!.text, isError: res.isError };
}

function namesInOrder(text: string, names: readonly string[]): string[] {
  return names.filter((n) => text.includes(n)).sort((a, b) => text.indexOf(a) - text.indexOf(b));
}

function routed(name: string): KgMock {
  return createKgMock(() => kgRes(kgFx(name)));
}

describe("find_kindergarten", () => {
  it("input: numeric strings accepted, out-of-range rejected without fetch", async () => {
    const mock = createKgMock();
    const ok = await run({ region: "성동구", age: "4", limit: "5" }, kgCtx(mock));
    expect(ok.isError).toBeFalsy();
    expect(ok.text).toContain("기준 연령 만4세");

    const bad: Record<string, unknown>[] = [
      { region: "성동구", limit: "0" },
      { limit: 31 },
      { region: "성동구", age: "2" },
      { region: "성동구", age: 6 },
      { region: "" },
      { region: "성동구", establish: "" },
      {},
    ];
    const before = mock.count();
    for (const args of bad) {
      const res = await run(args, kgCtx(mock));
      expect(res.isError).toBe(true);
      expect(res.text).toContain("입력 검증 실패");
      expect(res.text).toContain("예:");
    }
    expect(mock.count()).toBe(before);
  });

  it("no key: guide without fetch", async () => {
    const mock = createKgMock();
    const res = await run({ region: "성동구" }, kgCtx(mock, { env: { KINDERGARTEN_API_KEY: "" } }));
    expect(res.isError).toBe(true);
    expect(res.text).toContain("KINDERGARTEN_API_KEY");
    expect(res.text).toContain("SNS");
    expect(res.text).toContain("담당자 승인");
    expect(mock.count()).toBe(0);
  });

  it("region: codes in request", async () => {
    const cases = [
      ["성동구", "11", "11200"],
      ["수원 영통구", "41", "41117"],
      ["세종", "36", "36110"],
    ] as const;
    for (const [region, sido, sgg] of cases) {
      const mock = createKgMock();
      const res = await run({ region }, kgCtx(mock));
      expect(res.isError).toBeFalsy();
      expect(mock.count()).toBe(1);
      expect(mock.calls[0]!.searchParams.get("sidoCode")).toBe(sido);
      expect(mock.calls[0]!.searchParams.get("sggCode")).toBe(sgg);
    }
  });

  it("region: guidance without fetch", async () => {
    const cases: [string, string][] = [
      ["중구", "후보"],
      ["인천 서구", "폐지"],
      ["성수동", "구 단위"],
      ["고양시", "고양시 덕양구"],
      ["고양시", "고양시 일산동구"],
      ["고양시", "고양시 일산서구"],
      ["고양시", "코드표에 없어"],
      ["서울", "시군구 이름을 함께"],
    ];
    for (const [region, expected] of cases) {
      const mock = createKgMock();
      const res = await run({ region }, kgCtx(mock));
      expect(res.isError).toBeFalsy();
      expect(res.text).toContain(expected);
      expect(mock.count()).toBe(0);
    }
  });

  it("fixture summary fields", async () => {
    const { text } = await run({ region: "성동구" }, kgCtx(routed("basicInfo2.json")));
    for (const name of BASE_ORDER) expect(text).toContain(name);
    for (const s of [
      "공립(병설)",
      "사립(법인)",
      "주소: 서울특별시 성동구 마장로35나길 31 · 전화: 02-2282-2831",
      "2026년 2차(공시차수 20262)",
      "   만3세: 정원 14 · 현원 13 · 학급 1 → 여석 추정 1명",
      "특수학급: 정원 4 · 현원 0 · 학급 1 (연령반 추정에서 제외)",
      "인가 총정원 110",
      "홈페이지: http://geumho.sen.es.kr/",
      "전체 후보 5곳 모두 표시",
    ]) {
      expect(text).toContain(s);
    }
  });

  it("sorting by total and by age", async () => {
    const total = await run({ region: "성동구" }, kgCtx(routed("basicInfo2.json")));
    expect(namesInOrder(total.text, BASE_ORDER)).toEqual(BASE_ORDER);

    const age3 = await run({ region: "성동구", age: "3" }, kgCtx(routed("basicInfo2.json")));
    expect(namesInOrder(age3.text, BASE_ORDER)).toEqual(AGE3_ORDER);
    expect(age3.text).toContain("만3세(기준)");
  });

  it("establish filter", async () => {
    const sa = await run({ region: "성동구", establish: "사립" }, kgCtx(routed("basicInfo2.json")));
    expect(sa.isError).toBeFalsy();
    expect(sa.text).toContain(ROSA);
    expect(sa.text).not.toContain(MAJANG);
    expect(sa.text).toContain("설립유형 조건으로 4곳 제외");

    const gong = await run({ region: "성동구", establish: "공립" }, kgCtx(routed("basicInfo2.json")));
    expect(gong.isError).toBeFalsy();
    expect(gong.text).toContain("1곳 제외");

    const none = await run({ region: "성동구", establish: "사립(사인)" }, kgCtx(routed("basicInfo2.json")));
    expect(none.isError).toBeFalsy();
    expect(none.text).toContain('설립유형 "사립(사인)"에 맞는 유치원이 없습니다(오류 아님)');
  });

  it("mixed rounds use the newest round per kindergarten", async () => {
    const { text } = await run({ region: "성동구" }, kgCtx(routed("mixed-rounds.json")));
    expect(text).toContain("유치원 2곳");
    expect(text).toContain("일부 유치원은 이전 차수 기준 포함(1곳");
    expect(text).toContain("2024년 2차(공시차수 20242) · 이전 차수 기준");
    expect(text).toContain("현원 13");
    expect(text).not.toContain("현원 3 ");
    expect(text).toContain("공시 차수: 2026년 2차(공시차수 20262), 2024년 2차(공시차수 20242)");
  });

  it("edge values: no zero assumption", async () => {
    const { text } = await run({ region: "성동구" }, kgCtx(routed("edge-values.json")));
    for (const s of [
      "총정원 기준 여석 추정 23명(연령별 정원 정보 없음)",
      "산출 불가(연령별·총정원 정보 없음)",
      "연령반 합계 정원 충족(여석 없음 추정)",
      "만3세: 정원 0 · 현원 0 · 학급 0 → 해당 연령반 없음(공시 정원 0)",
      "만3세: 정원 정보 없음 · 현원 5 · 학급 1 → 산출 불가(정보 없음)",
      "설립유형 정보 없음",
      "주소: 정보 없음 · 전화: 정보 없음",
      "홈페이지: https://example.invalid/kg",
      "이름이 없는 항목 1건은 제외했습니다.",
    ]) {
      expect(text).toContain(s);
    }
    for (const s of ["www.example.invalid", "37.1234567", "무시"]) {
      expect(text).not.toContain(s);
    }
    expect(namesInOrder(text, ["합성유치원가", "합성유치원나", "합성유치원다", "합성유치원라"])).toEqual([
      "합성유치원나",
      "합성유치원라",
      "합성유치원다",
      "합성유치원가",
    ]);
  });

  it("zero results are not an error", async () => {
    const { text, isError } = await run({ region: "성동구" }, kgCtx(routed("empty.json")));
    expect(isError).toBeFalsy();
    expect(text).toContain(ZERO_TEXT);
    expect(text).toContain("유치원알리미 사이트(https://e-childschoolinfo.moe.go.kr)");
    expect(text).toContain("공시 차수: 조회된 항목 없음");
  });

  it("suspect cap notice", async () => {
    const capped = await run({ region: "성동구" }, kgCtx(createKgMock(() => kgRes(kgBody(kgMany(100))))));
    expect(capped.text).toContain("일부만 조회되었을 수 있음");
    expect(capped.text).toContain("전체 후보 100곳 중 상위 10곳 표시");

    const under = await run({ region: "성동구" }, kgCtx(createKgMock(() => kgRes(kgBody(kgMany(28))))));
    expect(under.text).not.toContain("일부만 조회되었을 수 있음");
  });

  it("size cap keeps footer", async () => {
    const normal = await run({ region: "성동구" }, kgCtx(createKgMock(() => kgRes(kgBody(kgMany(28))))));
    expect(normal.text.length).toBeLessThanOrEqual(8000);

    const capped = await run(
      { region: "성동구", limit: 30 },
      kgCtx(createKgMock(() => kgRes(kgBody(kgMany(28)))), { config: { maxResponseChars: 1000 } }),
    );
    expect(capped.text.length).toBeLessThanOrEqual(1000);
    for (const s of ["생략", "출처: 유치원알리미", "공시 차수:", "조회 시각", "공공기관이 제공하는 공개 API와 자료를 이용해 정리해 드려요.", "유치원·교육청·유치원알리미에서 확인"]) {
      expect(capped.text).toContain(s);
    }
  });

  it("upstream errors are tool errors with distinct text", async () => {
    const cases: [string, string][] = [
      ["denied.json", "유효하지 않은 키"],
      ["error.json", "ERROR"],
      ["error-page.html", "웹 페이지(HTML)"],
      ["no-list.json", "kinderInfo"],
    ];
    const texts: string[] = [];
    for (const [name, expected] of cases) {
      const res = await run({ region: "성동구" }, kgCtx(routed(name)));
      expect(res.isError).toBe(true);
      expect(res.text).toContain(expected);
      texts.push(res.text);
    }
    expect(new Set(texts).size).toBe(cases.length);
    const denied = texts[0]!;
    expect(denied).toContain("KINDERGARTEN_API_KEY");
  });

  it("notices and wording", async () => {
    const outputs: string[] = [];
    const ok = (args: Record<string, unknown>, mock: KgMock) => run(args, kgCtx(mock));
    outputs.push((await ok({ region: "성동구" }, routed("basicInfo2.json"))).text);
    outputs.push((await ok({ region: "성동구", age: "4" }, routed("basicInfo2.json"))).text);
    outputs.push((await ok({ region: "성동구", establish: "공립" }, routed("basicInfo2.json"))).text);
    outputs.push((await ok({ region: "성동구" }, routed("mixed-rounds.json"))).text);
    outputs.push((await ok({ region: "성동구" }, routed("edge-values.json"))).text);
    outputs.push((await ok({ region: "성동구" }, routed("empty.json"))).text);
    outputs.push((await ok({ region: "고양시" }, createKgMock())).text);
    outputs.push((await ok({ region: "중구" }, createKgMock())).text);
    outputs.push((await ok({ region: "성동구" }, routed("denied.json"))).text);
    outputs.push((await ok({ region: "성동구" }, createKgMock(() => kgRes(kgBody(kgMany(100)))))).text);

    for (const text of outputs) {
      expect(matchedPatterns(text, [KINDERGARTEN_ASSERT, ...OFFICIAL_CLAIM_OUTPUT])).toEqual([]);
    }
    const success = outputs.slice(0, 6).concat([outputs[9]!]);
    for (const text of success) {
      for (const s of SUCCESS_NOTICES) expect(text).toContain(s);
    }
    expect(matchedPatterns(findKindergartenTool.title + findKindergartenTool.description, [KINDERGARTEN_ASSERT])).toEqual([]);
  });

  it("never leaks key or input into logs", async () => {
    const logs: string[] = [];
    const sink = (line: string) => logs.push(line);
    const texts: string[] = [];
    texts.push((await run({ region: "성동구" }, kgCtx(routed("basicInfo2.json"), { sink }))).text);
    texts.push((await run({ region: "성동구" }, kgCtx(routed("denied.json"), { sink }))).text);
    texts.push((await run({ region: "성동구" }, kgCtx(routed("error.json"), { sink }))).text);
    texts.push((await run({ region: "성동구" }, kgCtx(createKgMock(), { sink, env: { KINDERGARTEN_API_KEY: "" } }))).text);

    const combined = texts.join("\n") + "\n" + logs.join("\n");
    for (const form of KG_KEY_FORMS) expect(combined).not.toContain(form);
    const logText = logs.join("\n");
    expect(logText).not.toContain("성동구");
    expect(logText).not.toContain("11200");
  });

  it("cache: one fetch per region", async () => {
    const mock = createKgMock();
    const ctx = kgCtx(mock);
    await run({ region: "성동구" }, ctx);
    await run({ region: "성동구" }, ctx);
    expect(mock.count()).toBe(1);
    await run({ region: "수원 영통구" }, ctx);
    expect(mock.count()).toBe(2);
    expect(mock.calls[0]!.pathname).toBe(KG_PATH);
  });

  it("deterministic snapshot", async () => {
    const first = (await run({ region: "성동구" })).text;
    const second = (await run({ region: "성동구" })).text;
    expect(second).toBe(first);
    await expect(first).toMatchFileSnapshot("./__snapshots__/find-kindergarten-seongdong.txt");
  });
});
