import { describe, expect, it } from "vitest";
import { NEMC_DEPT_PEDIATRICS, NEMC_SEND_QT } from "../src/clients/data-go-kr-specs.js";
import { dataGoKrError } from "../src/core/errors.js";
import { runTool } from "../src/core/pipeline.js";
import { findNightPediatricTool } from "../src/tools/find-night-pediatric.js";
import { bundledYearEntries, entriesToItems, hangUntilAbort, htmlRes200, kasiXml, xmlRes } from "./helpers/kasi-mock.js";
import { KEY_FORMS, createNemcMock, nemcCtx, nemcFx, nemcXml } from "./helpers/nemc-mock.js";

type Ctx = ReturnType<typeof nemcCtx>;

const run = (args: Record<string, unknown>, ctx: Ctx) => runTool(findNightPediatricTool, args, ctx);
const textOf = (res: { content: { type: "text"; text: string }[] }): string => res.content[0]!.text;

const expectQt = (u: URL | undefined, v: string): void => {
  if (NEMC_SEND_QT) expect(u!.searchParams.get("QT")).toBe(v);
  else expect(u!.searchParams.has("QT")).toBe(false);
};

const general = (code: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?><OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>${code}</returnReasonCode><returnAuthMsg>오류</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>`;

const forbidden = (): Response =>
  new Response(nemcFx("nemcList/error-bad-key.xml"), { status: 403, headers: { "content-type": "application/xml" } });

const statusLine = (text: string, name: string): string =>
  text.split("\n").find((l) => l.includes(`${name} [`)) ?? "";

const block = (text: string, name: string): string => {
  const lines = text.split("\n");
  const i = lines.findIndex((l) => l.includes(`${name} [`));
  return lines.slice(i, i + 4).join("\n");
};

const expectedQtKeys = (): string[] => ["serviceKey", "Q0", "Q1", "numOfRows", ...(NEMC_SEND_QT ? ["QT"] : [])];

describe("find_night_pediatric input", () => {
  it("limit accepts numeric string", async () => {
    const res = await run({ region: "성동구", limit: "2" }, nemcCtx(createNemcMock()));
    const text = textOf(res);
    expect(res.isError).toBeFalsy();
    expect(text).toContain("1. ");
    expect(text).toContain("2. ");
    expect(text).not.toContain("3. ");
  });

  it("limit out of range is BAD_INPUT", async () => {
    for (const limit of [0, 11]) {
      const mock = createNemcMock();
      const res = await run({ region: "성동구", limit }, nemcCtx(mock));
      expect(res.isError).toBe(true);
      expect(textOf(res)).toContain("limit");
      expect(mock.urls.length).toBe(0);
    }
  });

  it("too long region is BAD_INPUT", async () => {
    const mock = createNemcMock();
    const res = await run({ region: "가".repeat(41) }, nemcCtx(mock));
    expect(res.isError).toBe(true);
    expect(mock.urls.length).toBe(0);
  });

  it("invalid now is BAD_INPUT", async () => {
    const res = await run({ region: "성동구", now: "2026-10-28" }, nemcCtx(createNemcMock()));
    expect(res.isError).toBe(true);
  });
});

describe("find_night_pediatric summary", () => {
  it("seongdong summary at Wed 21:30", async () => {
    const mock = createNemcMock();
    const res = await run({ region: "성동구" }, nemcCtx(mock));
    const text = textOf(res);
    expect(res.isError).toBeFalsy();
    expect(text.split("365다움의원").length - 1).toBe(1);
    expect(statusLine(text, "365다움의원")).toContain("[달빛어린이병원]");
    expect(statusLine(text, "365다움의원")).toContain("진료 중");
    expect(statusLine(text, "365연세의원")).toContain("[진료과목에 소아청소년과 포함]");
    expect(text).toContain("구분: [진료과목에 소아청소년과 포함]은");
    expect(text).toContain("02-2297-1755");
    expect(text).toContain("운영시간(수요일): 18:00~24:00");
    expect(text).toContain("국립중앙의료원(공공데이터포털)");
    expect(text).toContain("조회 시각");
    expect(text).toContain("공휴일 달력:");
    expect(text).toContain("119");
    expect(text).toContain("전화로 확인");
    expect(text).toContain("의료 면책");
    expect(text).toContain("공공기관이 제공하는 공개 API와 자료를 이용해 정리해 드려요.");

    const moonUrl = mock.last("moon")!;
    expect(new Set(moonUrl.searchParams.keys())).toEqual(new Set(["serviceKey", "Q0", "Q1", "numOfRows"]));
    expect(moonUrl.searchParams.has("QT")).toBe(false);
    expect(moonUrl.searchParams.get("Q0")).toBe("서울특별시");
    expect(moonUrl.searchParams.get("Q1")).toBe("성동구");

    const pedsUrl = mock.last("peds")!;
    expect(new Set(pedsUrl.searchParams.keys())).toEqual(new Set([...expectedQtKeys(), "QD"]));
    expect(pedsUrl.searchParams.get("QD")).toBe(NEMC_DEPT_PEDIATRICS);
  });

  it("ranks pediatric-named clinics before other departments", async () => {
    const mock = createNemcMock({
      peds: () =>
        xmlRes(
          nemcXml([
            { hpid: "N1", dutyName: "강내과의원", dutyAddr: "서울특별시 성동구 가로 1", dutyTime3s: "1800", dutyTime3c: "2300" },
            { hpid: "N2", dutyName: "박소아과의원", dutyAddr: "서울특별시 성동구 가로 2", dutyTime3s: "1800", dutyTime3c: "2300" },
          ]),
        ),
    });
    const res = await run({ region: "성동구", now: "2026-10-28T21:30", limit: 10 }, nemcCtx(mock));
    const text = textOf(res);
    expect(res.isError).toBeFalsy();
    const pos = (name: string) => text.indexOf(name);
    expect(pos("365다움의원")).toBeGreaterThanOrEqual(0);
    expect(pos("365다움의원")).toBeLessThan(pos("박소아과의원"));
    expect(pos("박소아과의원")).toBeLessThan(pos("강내과의원"));
    expect(statusLine(text, "박소아과의원")).toContain("[소아청소년과]");
    expect(statusLine(text, "박소아과의원")).toContain("진료 중");
    expect(statusLine(text, "강내과의원")).toContain("[진료과목에 소아청소년과 포함]");
    expect(statusLine(text, "강내과의원")).toContain("진료 중");
  });
});

describe("find_night_pediatric derived hours", () => {
  const derivedMock = () =>
    createNemcMock({
      moon: () => xmlRes(nemcFx("nemcMoonlight/empty.xml")),
      peds: () => xmlRes(nemcFx("nemcList/derived-hours.xml")),
    });

  it("derived hours at 23:30 Wed", async () => {
    const res = await run({ region: "성동구", now: "2026-10-28T23:30", limit: 10 }, nemcCtx(derivedMock()));
    const text = textOf(res);
    expect(res.isError).toBeFalsy();
    expect(statusLine(text, "파생야간의원")).toContain("진료 중");
    expect(statusLine(text, "파생자정의원")).toContain("진료 중");
    expect(statusLine(text, "파생정보없음의원")).toContain("확인 불가");
    expect(block(text, "파생정보없음의원")).toContain("운영시간 확인 불가");
    expect(block(text, "파생정보없음의원")).toContain("전화: 정보 없음");
    expect(statusLine(text, "파생형식오류의원")).toContain("확인 불가");
    expect(statusLine(text, "파생새벽의원")).toContain("진료 시간 아님");
  });

  it("derived hours at 00:30 Wed", async () => {
    const res = await run({ region: "성동구", now: "2026-10-28T00:30", limit: 10 }, nemcCtx(derivedMock()));
    const text = textOf(res);
    expect(res.isError).toBeFalsy();
    expect(statusLine(text, "파생야간의원")).toContain("진료 중");
    expect(block(text, "파생야간의원")).toContain("전날(화요일)");
    expect(statusLine(text, "파생새벽의원")).toContain("진료 중");
    expect(statusLine(text, "파생자정의원")).toContain("진료 시간 아님");
  });

  it("derived hours at 01:30 Wed", async () => {
    const res = await run({ region: "성동구", now: "2026-10-28T01:30", limit: 10 }, nemcCtx(derivedMock()));
    const text = textOf(res);
    expect(res.isError).toBeFalsy();
    expect(statusLine(text, "파생야간의원")).toContain("진료 시간 아님");
    expect(statusLine(text, "파생새벽의원")).toContain("진료 중");
  });

  it("single, empty and partial-field responses do not throw", async () => {
    const single = createNemcMock({ peds: () => xmlRes(nemcFx("nemcList/single.xml")) });
    const singleRes = await run({ region: "성동구" }, nemcCtx(single));
    expect(singleRes.isError).toBeFalsy();

    const empty = createNemcMock({
      moon: () => xmlRes(nemcFx("nemcMoonlight/empty.xml")),
      peds: () => xmlRes(nemcFx("nemcList/empty.xml")),
    });
    const emptyRes = await run({ region: "성동구" }, nemcCtx(empty));
    expect(emptyRes.isError).toBeFalsy();

    const partial = createNemcMock({ peds: () => xmlRes(nemcFx("nemcList/seongdong.xml")) });
    const partialRes = await run({ region: "성동구", now: "2026-10-05T10:00", limit: 10 }, nemcCtx(partial));
    expect(partialRes.isError).toBeFalsy();
    expect(statusLine(textOf(partialRes), "365답십리탑정형외과의원")).toContain("확인 불가");
  });
});

describe("find_night_pediatric day slot", () => {
  const scenario = async (now: string, kasi?: (year: number) => Response) => {
    const mock = createNemcMock(kasi ? { kasi } : {});
    const res = await run({ region: "성동구", now }, nemcCtx(mock, { clockIso: `${now}:00+09:00` }));
    return { res, text: textOf(res), mock };
  };

  it("weekday uses Wednesday slot", async () => {
    const { res, text, mock } = await scenario("2026-10-28T21:30");
    expect(res.isError).toBeFalsy();
    expect(mock.last("moon")!.searchParams.has("QT")).toBe(false);
    expectQt(mock.last("peds"), "3");
    expect(text).toContain("판정 기준: 수요일");
  });

  it("saturday uses Saturday slot", async () => {
    const { res, text, mock } = await scenario("2026-10-31T10:00");
    expect(res.isError).toBeFalsy();
    expectQt(mock.last("peds"), "6");
    expect(text).toContain("토요일");
  });

  it("sunday uses Sunday slot", async () => {
    const { res, text, mock } = await scenario("2026-11-01T10:00");
    expect(res.isError).toBeFalsy();
    expectQt(mock.last("peds"), "7");
    expect(text).toContain("일요일");
  });

  it("bundled holiday uses holiday slot even when live lookup fails", async () => {
    const { res, text, mock } = await scenario("2026-10-05T10:00", () => htmlRes200());
    expect(res.isError).toBeFalsy();
    expectQt(mock.last("peds"), "8");
    expect(text).toContain("판정 기준: 공휴일");
    expect(text).toContain("번들(생성일");
  });

  it("live-only holiday uses holiday slot", async () => {
    const liveRoute = (year: number) =>
      xmlRes(
        kasiXml(
          entriesToItems([...bundledYearEntries(year), { date: "2026-11-11", name: "임시공휴일" }]),
        ),
      );
    const live = await scenario("2026-11-11T10:00", liveRoute);
    expect(live.res.isError).toBeFalsy();
    expectQt(live.mock.last("peds"), "8");
    expect(live.text).toContain("공휴일");
    expect(live.text).toContain("공공데이터 API 확인");

    const control = await scenario("2026-11-11T10:00", () => htmlRes200());
    expectQt(control.mock.last("peds"), "3");
  });

  it("no key makes no network call", async () => {
    const mock = createNemcMock();
    const res = await runTool(findNightPediatricTool, { region: "성동구" }, nemcCtx(mock, { env: { DATA_GO_KR_SERVICE_KEY: "" } }));
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("DATA_GO_KR_SERVICE_KEY");
    expect(mock.urls.length).toBe(0);
  });

  it("year outside bundle is reported as missing", async () => {
    const { res, text, mock } = await scenario("2030-03-05T10:00", () => xmlRes(kasiXml([])));
    expect(res.isError).toBeFalsy();
    expectQt(mock.last("peds"), "2");
    expect(text).toContain("2030년 공휴일 정보 없음");
  });
});

describe("find_night_pediatric determinism", () => {
  it("seongdong output is identical across runs and matches snapshot", async () => {
    const first = textOf(await run({ region: "성동구" }, nemcCtx(createNemcMock())));
    const second = textOf(await run({ region: "성동구" }, nemcCtx(createNemcMock())));
    expect(first).toBe(second);
    await expect(first).toMatchFileSnapshot("./__snapshots__/night-pediatric-seongdong.txt");
  });

  it("orders judged clinics by status then kind then source order", async () => {
    const mock = createNemcMock({ peds: () => xmlRes(nemcFx("nemcList/derived-hours.xml")) });
    const res = await run({ region: "성동구", now: "2026-10-28T23:30", limit: 10 }, nemcCtx(mock));
    const text = textOf(res);
    const order = ["365다움의원", "파생야간의원", "파생자정의원", "파생정보없음의원", "파생형식오류의원", "파생새벽의원"];
    const positions = order.map((name) => text.indexOf(name));
    expect(positions.every((p) => p >= 0)).toBe(true);
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]!).toBeGreaterThan(positions[i - 1]!);
    }
  });
});

describe("find_night_pediatric fetch and caching", () => {
  it("no cache: repeated calls refetch", async () => {
    const mock = createNemcMock();
    const ctx = nemcCtx(mock);
    await run({ region: "성동구" }, ctx);
    await run({ region: "성동구" }, ctx);
    expect(mock.count("moon")).toBe(2);
    expect(mock.count("peds")).toBe(2);
  });

  it("partial fetch notice when the list is truncated", async () => {
    const res = await run({ region: "성동구" }, nemcCtx(createNemcMock()));
    expect(textOf(res)).toContain("일부만 조회: 소아청소년과 목록");
  });

  it("body is capped and footer kept", async () => {
    const many = Array.from({ length: 100 }, (_, i) => ({
      hpid: `G${String(i).padStart(4, "0")}`,
      dutyName: `생성의원${i}`,
      dutyAddr: `서울특별시 성동구 생성로 ${i}`,
      dutyTel1: `02-0000-${String(i).padStart(4, "0")}`,
      dutyTime3s: "0900",
      dutyTime3c: "2100",
    }));
    const mock = createNemcMock({ peds: () => xmlRes(nemcXml(many, 500)) });
    const res = await run({ region: "성동구", limit: 10 }, nemcCtx(mock, { env: { KPM_MAX_RESPONSE_CHARS: "1000" } }));
    const text = textOf(res);
    expect(text.length).toBeLessThanOrEqual(1000);
    expect(text).toContain("공공기관이 제공하는 공개 API와 자료를 이용해 정리해 드려요.");
    expect(text).toContain("119");
  });

  it("default body limit follows config", async () => {
    const ctx = nemcCtx(createNemcMock());
    const res = await run({ region: "성동구" }, ctx);
    expect(textOf(res).length).toBeLessThanOrEqual(ctx.config.maxResponseChars);
  });
});

describe("find_night_pediatric zero results and guidance", () => {
  it("zero results are not an error", async () => {
    const mock = createNemcMock({
      moon: () => xmlRes(nemcFx("nemcMoonlight/empty.xml")),
      peds: () => xmlRes(nemcFx("nemcList/empty.xml")),
    });
    const res = await run({ region: "성동구" }, nemcCtx(mock));
    const text = textOf(res);
    expect(res.isError).toBeFalsy();
    expect(text).toContain("(정상 조회)");
    expect(text).toContain("응급의료포털");
    expect(text).toContain("인근");
  });

  it.each([
    ["중구", "서울특별시 중구"],
    ["인천 서구", "폐지"],
    ["성수동", "구 단위로 입력"],
    ["서울", "시군구 단위"],
  ])("region guidance for %s makes no fetch", async (region, expected) => {
    const mock = createNemcMock();
    const res = await run({ region }, nemcCtx(mock));
    expect(res.isError).toBeFalsy();
    expect(textOf(res)).toContain(expected);
    expect(mock.urls.length).toBe(0);
  });
});

describe("find_night_pediatric error mapping", () => {
  it.each(["20", "22", "23", "30", "31"])("error code %s maps to M8 guidance", async (code) => {
    const mock = createNemcMock({ moon: () => xmlRes(general(code)), peds: () => xmlRes(general(code)) });
    const res = await run({ region: "성동구" }, nemcCtx(mock));
    const text = textOf(res);
    expect(res.isError).toBe(true);
    expect(text).toContain(dataGoKrError(code).message);
    expect(text).toContain(dataGoKrError(code).actions[0]!);
  });

  it("gateway key error maps to KEY_INVALID", async () => {
    const mock = createNemcMock({ moon: forbidden, peds: forbidden });
    const res = await run({ region: "성동구" }, nemcCtx(mock));
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("KEY_INVALID");
  });

  it("moonlight list failure is partial", async () => {
    const mock = createNemcMock({ moon: () => htmlRes200() });
    const res = await run({ region: "성동구" }, nemcCtx(mock));
    const text = textOf(res);
    expect(res.isError).toBeFalsy();
    expect(text).toContain("달빛어린이병원 목록 조회 실패");
    expect(text).toContain("조치:");
    expect(text).toContain("365연세의원");
  });

  it("pediatric list failure is partial", async () => {
    const mock = createNemcMock({ peds: () => xmlRes(general("22")) });
    const res = await run({ region: "성동구" }, nemcCtx(mock));
    const text = textOf(res);
    expect(res.isError).toBeFalsy();
    expect(text).toContain("소아청소년과 목록 조회 실패");
    expect(text).toContain("365다움의원");
  });

  it("both lists failing returns the highest-priority error", async () => {
    const mock = createNemcMock({ moon: () => xmlRes(general("30")), peds: () => htmlRes200() });
    const res = await run({ region: "성동구" }, nemcCtx(mock));
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("KEY_INVALID");
  });

  it("deadline exceeded is partial and not waited", async () => {
    const mock = createNemcMock({ moon: (_u, init) => hangUntilAbort(init) });
    const started = Date.now();
    const res = await run({ region: "성동구" }, nemcCtx(mock, { config: { chainDeadlineMs: 200 } }));
    const elapsed = Date.now() - started;
    const text = textOf(res);
    expect(elapsed).toBeLessThan(3000);
    expect(res.isError).toBeFalsy();
    expect(text).toContain("달빛어린이병원 목록 조회 실패");
    expect(text).toContain("시간 초과");
  });

  it("service key never leaks into results or logs", async () => {
    const scenarios: { name: string; routes: Parameters<typeof createNemcMock>[0] }[] = [
      { name: "success", routes: {} },
      { name: "partial", routes: { moon: () => htmlRes200() } },
      { name: "all fail", routes: { moon: () => xmlRes(general("30")), peds: () => htmlRes200() } },
    ];
    for (const s of scenarios) {
      const lines: string[] = [];
      const mock = createNemcMock(s.routes);
      const res = await run({ region: "성동구" }, nemcCtx(mock, { sink: (l) => lines.push(l) }));
      const all = [textOf(res), ...lines].join("\n");
      for (const form of KEY_FORMS) {
        expect(all, s.name).not.toContain(form);
      }
    }
  });
});
