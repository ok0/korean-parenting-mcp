import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ClinicLinkProvider } from "../src/clinic/guide.js";
import type { ToolContext } from "../src/core/context.js";
import { runTool } from "../src/core/pipeline.js";
import { formatDate, parseDate } from "../src/date/civil-date.js";
import { checkupItems } from "../src/timeline/rules/checkups.js";
import { createFindCheckupClinicTool, findCheckupClinicTool } from "../src/tools/find-checkup-clinic.js";
import { createTestContext } from "./helpers/context.js";
import { OBSERVED_CLINIC_URLS, URL_RE } from "./helpers/clinic-urls.js";
import { CLINIC_ASSERT, OFFICIAL_CLAIM_OUTPUT, matchedPatterns } from "./helpers/wording.js";

const fetchSpy = vi.fn(async (): Promise<Response> => {
  throw new Error("network disabled");
});

function ctxWith(extra: Partial<ToolContext> = {}): ToolContext {
  return { ...createTestContext(), fetch: fetchSpy as unknown as ToolContext["fetch"], ...extra };
}

async function run(args: Record<string, unknown>, ctx: ToolContext = ctxWith()) {
  return runTool(findCheckupClinicTool, args, ctx);
}

function textOf(res: { content: { type: "text"; text: string }[] }): string {
  return res.content[0]!.text;
}

const T = "2026-10-28";
const B5 = { region: "성동구", birth_date: "2026-05-28", today: T };

function stageBlock(text: string): string {
  return text.split("\n\n").find((b) => b.startsWith("[아이 단계 정보")) ?? "";
}

afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled();
  fetchSpy.mockClear();
});

describe("find_checkup_clinic", () => {
  it("input rejects invalid combinations and accepts defaults", async () => {
    const both = await run({ birth_date: "2026-05-28", due_date: "2027-03-15" });
    expect(both.isError).toBe(true);
    expect(textOf(both)).toContain("BAD_INPUT");
    expect(textOf(both)).toContain("함께 쓸 수 없습니다");

    const badDate = await run({ birth_date: "2026-02-30" });
    expect(badDate.isError).toBe(true);

    const compactToday = await run({ today: "20261028" });
    expect(compactToday.isError).toBeFalsy();

    const pastDue = await run({ due_date: "2026-10-01", today: T });
    expect(pastDue.isError).toBe(true);
    expect(textOf(pastDue)).toContain("birth_date");

    const futureBirth = await run({ birth_date: "2026-11-01", today: T });
    expect(futureBirth.isError).toBe(true);
    expect(textOf(futureBirth)).toContain("due_date");

    const longRegion = await run({ region: "가".repeat(41) });
    expect(longRegion.isError).toBe(true);

    const none = await run({});
    expect(none.isError).toBeFalsy();
    expect(textOf(none)).toContain("맞춤 안내");
  });

  it("no key needed", async () => {
    const ctx = { ...createTestContext({ env: {} }), fetch: fetchSpy as unknown as ToolContext["fetch"] };
    const res = await runTool(findCheckupClinicTool, { region: "성동구" }, ctx);
    expect(res.isError).toBeFalsy();
  });

  it("region normalized", async () => {
    const seongdong = textOf(await run({ region: "성동구" }));
    expect(seongdong).toContain("시도 '서울특별시' → 시군구 '성동구'");
    expect(seongdong).toContain("서울특별시 성동구 보건소에 지역 영유아 검진기관");

    const gyeonggi = textOf(await run({ region: "경기도" }));
    expect(gyeonggi).toContain("시도 '경기도'를 고른 뒤");
  });

  it.each([
    ["중구", "서울특별시 중구"],
    ["인천 서구", "폐지"],
    ["성수동", "구 단위로 입력"],
  ])("region guidance for %s", async (input, message) => {
    const res = await run({ region: input });
    expect(res.isError).toBeFalsy();
    const text = textOf(res);
    expect(text).toContain(message);
    expect(text).toContain("지역 없이 표시합니다");
    expect(text).toContain("[링크]");
    expect(text).toContain("https://www.nhis.or.kr/");
    expect(text).toContain("검진기관/병원찾기");
  });

  it("links are observed urls only", async () => {
    const inputs: Record<string, unknown>[] = [
      {},
      { region: "성동구" },
      B5,
      { due_date: "2027-03-15", today: T },
      { region: "인천 서구" },
    ];
    let all = "";
    for (const input of inputs) {
      const text = textOf(await run(input));
      all += text;
      for (const u of text.match(URL_RE) ?? []) {
        expect(OBSERVED_CLINIC_URLS.checkup).toContain(u);
      }
    }
    expect(all).toContain("건강iN");
    expect(all).toContain("메뉴 경로, 바로가기 주소 확인 필요");
    expect(all).toContain("영유아 탭");
    expect(all).toContain("1577-1000");
    expect(all).toContain("거주지와 관계없이");
    expect(all).toContain("확인 필요");
    expect(all).not.toContain("hi.nhis");
    expect(all).not.toContain("sido=");
    expect(all).not.toContain("sigungu=");
    expect(all).not.toContain("region=");
  });

  it("call first and prepare", async () => {
    const text = textOf(await run(B5));
    expect(text).toContain("검진 가능 일정·영유아 검진 지정 기관 여부를 먼저 확인");
    expect(text.indexOf("[먼저 전화로 확인]")).toBeLessThan(text.indexOf("[링크]"));
    expect(text).toContain("문진표");
    expect(text).toContain("보호자 신분증");
    expect(text).toContain("건강보험 자격");
    expect(text).toContain("구강검진");
    expect(text).toContain("본인부담");
  });

  it("provenance shown", async () => {
    const text = textOf(await run(B5));
    const lines = text.split("\n");
    const linkCount = lines.filter((l) => l.startsWith("  용도: ")).length;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.startsWith("  용도: ")) {
        expect(lines[i + 1]!.startsWith("  출처: ")).toBe(true);
      }
    }
    const sourceLines = lines.filter((l) => /^ *출처: /.test(l));
    expect(sourceLines.length).toBeGreaterThanOrEqual(linkCount + 5);
    expect(text).toContain("기준일 2026-10-28");
    expect(text).toContain("부분 검증");
  });

  it("provider boundary", async () => {
    const fake: ClinicLinkProvider = {
      links: () => [
        {
          id: "fake",
          label: "대체 제공자 링크",
          url: "https://example.test/checkup",
          purpose: "테스트",
          source: "테스트 출처",
          as_of: "2026-01-01",
          verified: "false",
          region_param: "unverified",
        },
      ],
    };
    const alt = createFindCheckupClinicTool(fake);
    expect(alt.name).toBe("find_checkup_clinic");
    expect(JSON.stringify(z.toJSONSchema(alt.schema))).toBe(JSON.stringify(z.toJSONSchema(findCheckupClinicTool.schema)));

    const altText = textOf(await runTool(alt, B5, ctxWith()));
    const defaultText = textOf(await run(B5));
    expect(altText).toContain("https://example.test/checkup");
    expect(altText).toContain("대체 제공자 링크");
    for (const u of OBSERVED_CLINIC_URLS.checkup) {
      expect(altText).not.toContain(u);
    }
    const heads = (t: string): string[] => t.split("\n").filter((l) => l.startsWith("["));
    expect(heads(altText)).toEqual(heads(defaultText));

    const source = readFileSync(new URL("../src/tools/find-checkup-clinic.ts", import.meta.url), "utf8");
    expect(source).not.toContain("loadData");
    expect(source).not.toContain("clinic-guide");
    expect(source).not.toContain("fetch");
    expect(source).not.toContain("http:");
  });

  it("stage birth 5 months", async () => {
    const text = textOf(await run(B5));
    expect(text).toContain("영유아 건강검진 지금 기간 중인 회차:\n  - 영유아 건강검진 2차 (4~6개월): 2026-09-28~2026-12-27 · 부분 검증");
    expect(text).toContain("영유아 건강검진 3차 (9~12개월): 2027-02-28~2027-06-27");
    expect(text).toContain("영유아 구강검진 지금 기간 중인 회차: 없음");

    const oral = checkupItems(parseDate("2026-05-28")).find((i) => i.id === "oral-checkup-1")!;
    expect(text).toContain(`${oral.title}: ${formatDate(oral.start)}~${formatDate(oral.end!)}`);

    expect(text).toContain("출처: 건강검진 실시기준");
    expect(text).toContain("부분 검증");
    expect(text).toContain("검진 결과나 개인 검진 기록을 조회하지 않습니다");
  });

  it("stage older", async () => {
    const text = textOf(await run({ birth_date: "2019-01-01", today: T }));
    expect(text).toContain("영유아 건강검진 다음 회차: 등록된 회차 없음");
    expect(text).toContain("영유아 구강검진 다음 회차: 등록된 회차 없음");
  });

  it("stage due and none differ", async () => {
    const due = textOf(await run({ due_date: "2027-03-15", today: T }));
    expect(due).toContain("1차(생후 14~35일) 검진 시기부터 시작");

    const none = textOf(await run({ today: T }));
    expect(none).toContain("맞춤 안내");
    expect(none).toContain("8차 66~71개월");
    expect(none).toContain("4차 54~65개월");
    expect(stageBlock(none).match(/\d차 /g)?.length).toBe(12);

    const birth = textOf(await run(B5));
    const sections = new Set([stageBlock(birth), stageBlock(due), stageBlock(none)]);
    expect(sections.size).toBe(3);
  });

  it("deterministic snapshot", async () => {
    const first = textOf(await run(B5));
    const second = textOf(await run(B5));
    expect(second).toBe(first);
    await expect(first).toMatchFileSnapshot("./__snapshots__/find-checkup-clinic-seongdong.txt");
  });

  it("today injection", async () => {
    const clockCtx = ctxWith({ clock: { now: () => new Date("2026-10-28T21:30:00+09:00") } });
    const implicit = textOf(await runTool(findCheckupClinicTool, {}, clockCtx));
    expect(implicit).toContain("기준일 2026-10-28");
    const explicit = textOf(await runTool(findCheckupClinicTool, { today: T }, clockCtx));
    expect(implicit).toBe(explicit);
  });

  it("notices and wording", async () => {
    const scenarios: Record<string, unknown>[] = [
      {},
      { region: "성동구" },
      { region: "인천 서구" },
      B5,
      { due_date: "2027-03-15", today: T },
      { birth_date: "2019-01-01", region: "경기도", today: T },
    ];
    for (const input of scenarios) {
      const text = textOf(await run(input));
      expect(text).toContain("데이터를 조회하지 않으며");
      expect(text).toContain("비공식 도구");
      expect(text).toContain("최종 확인");
      expect(text).toContain("의료 면책");
      expect(text).toContain("해당 의료기관");
      expect(text).toContain("보건소");
      expect(text).toContain("get_timeline");
      expect(text).toContain("find_benefits");
      expect(matchedPatterns(text, [CLINIC_ASSERT])).toEqual([]);
      expect(matchedPatterns(text, OFFICIAL_CLAIM_OUTPUT)).toEqual([]);
    }
  });

  it("no input in logs", async () => {
    const lines: string[] = [];
    const ctx = { ...createTestContext({ sink: (l) => lines.push(l) }), fetch: fetchSpy as unknown as ToolContext["fetch"] };
    await run(B5, ctx);
    const logged = lines.join("\n");
    expect(logged).not.toContain("성동구");
    expect(logged).not.toContain("2026-05-28");
  });

  it("size cap keeps footer", async () => {
    const small = createTestContext({ env: { KPM_MAX_RESPONSE_CHARS: "1000" } });
    const res = await runTool(findCheckupClinicTool, B5, { ...small, fetch: fetchSpy as unknown as ToolContext["fetch"] });
    const text = textOf(res);
    expect(text.length).toBeLessThanOrEqual(1000);
    expect(text).toContain("최종 확인");
    expect(text).toContain("의료 면책");
    expect(text).toContain("비공식 도구 고지");

    const normal = ctxWith();
    const full = textOf(await runTool(findCheckupClinicTool, B5, normal));
    expect(full.length).toBeLessThanOrEqual(normal.config.maxResponseChars);
    expect(full).not.toContain("자 생략");
  });
});
