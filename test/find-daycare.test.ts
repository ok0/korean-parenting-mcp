import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ToolContext } from "../src/core/context.js";
import { runTool } from "../src/core/pipeline.js";
import { loadData } from "../src/data-store/load.js";
import type { DaycareLinkProvider } from "../src/daycare/guide.js";
import { createFindDaycareTool, findDaycareTool } from "../src/tools/find-daycare.js";
import { createTestContext } from "./helpers/context.js";
import { DAYCARE_ASSERT, OFFICIAL_CLAIM_OUTPUT, matchedPatterns } from "./helpers/wording.js";

const fetchSpy = vi.fn(async (): Promise<Response> => {
  throw new Error("network disabled");
});

function ctxWith(extra: Partial<ToolContext> = {}): ToolContext {
  return { ...createTestContext(), fetch: fetchSpy as unknown as ToolContext["fetch"], ...extra };
}

async function run(args: Record<string, unknown>, ctx: ToolContext = ctxWith()) {
  return runTool(findDaycareTool, args, ctx);
}

function textOf(res: { content: { type: "text"; text: string }[] }): string {
  return res.content[0]!.text;
}

const URL_RE = /https?:\/\/[^\s)]+/g;
const DATA_URLS = loadData("daycare-guide").links.map((l) => l.url);

function waitlistSection(text: string): string {
  return text.split("\n\n").find((b) => b.startsWith("[입소대기")) ?? "";
}

afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled();
  fetchSpy.mockClear();
});

describe("find_daycare", () => {
  it("input rejects invalid combinations and accepts defaults", async () => {
    const both = await run({ birth_date: "2026-05-28", due_date: "2027-03-15" });
    expect(both.isError).toBe(true);
    expect(textOf(both)).toContain("BAD_INPUT");
    expect(textOf(both)).toContain("함께 쓸 수 없습니다");

    const badDate = await run({ birth_date: "2026-02-30" });
    expect(badDate.isError).toBe(true);

    const compactToday = await run({ today: "20261028" });
    expect(compactToday.isError).toBeFalsy();

    const pastDue = await run({ due_date: "2026-10-01", today: "2026-10-28" });
    expect(pastDue.isError).toBe(true);
    expect(textOf(pastDue)).toContain("birth_date");

    const longRegion = await run({ region: "가".repeat(41) });
    expect(longRegion.isError).toBe(true);

    const none = await run({});
    expect(none.isError).toBeFalsy();
    expect(textOf(none)).toContain("아이 정보 없음(일반 안내)");
  });

  it("no key needed", async () => {
    const res = await runTool(findDaycareTool, { region: "성동구" }, createTestContext({ env: {} }));
    expect(res.isError).toBeFalsy();
  });

  it("region normalized", async () => {
    const seongdong = textOf(await run({ region: "성동구" }));
    expect(seongdong).toContain("시도 '서울특별시' → 시군구 '성동구'");
    expect(seongdong).toContain("서울특별시 성동구 보육 담당 부서");

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
    expect(text).toContain(DATA_URLS[0]!);
  });

  it("links are data urls only", async () => {
    const inputs: Record<string, unknown>[] = [
      {},
      { region: "성동구" },
      { birth_date: "2026-05-28", today: "2026-10-28" },
      { due_date: "2027-03-15", today: "2026-10-28" },
    ];
    let all = "";
    for (const input of inputs) {
      const text = textOf(await run(input));
      all += text;
      for (const u of text.match(URL_RE) ?? []) {
        expect(DATA_URLS).toContain(u);
      }
    }
    expect(all).toContain("info.childcare.go.kr");
    expect(all).toContain("menuno=166");
    expect(all).toContain("menuno=176");
    expect(all).toContain("https://www.childcare.go.kr/");
    expect(all).not.toContain("sido=");
    expect(all).not.toContain("sigungu=");
    expect(all).not.toContain("region=");
    expect(all).toContain("유보통합");
  });

  it("provenance shown", async () => {
    const text = textOf(await run({ birth_date: "2026-05-28", region: "성동구", today: "2026-10-28" }));
    const lines = text.split("\n");
    const linkCount = lines.filter((l) => l.startsWith("  용도: ")).length;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.startsWith("  용도: ")) {
        expect(lines[i + 1]!.startsWith("  출처: ")).toBe(true);
      }
    }
    const sourceLines = lines.filter((l) => /^ *출처: /.test(l));
    expect(sourceLines.length).toBeGreaterThanOrEqual(linkCount + 3);
    expect(text).toContain("기준일 2026-10-28");
    expect(text).toContain("부분 검증");
  });

  it("provider boundary", async () => {
    const fake: DaycareLinkProvider = {
      links: () => [
        {
          id: "info-search",
          label: "대체 제공자 링크",
          url: "https://example.test/daycare",
          purpose: "테스트",
          source: "테스트 출처",
          as_of: "2026-01-01",
          verified: "false",
          region_param: "unverified",
        },
      ],
    };
    const alt = createFindDaycareTool(fake);
    expect(alt.name).toBe("find_daycare");
    expect(JSON.stringify(z.toJSONSchema(alt.schema))).toBe(JSON.stringify(z.toJSONSchema(findDaycareTool.schema)));

    const input = { region: "성동구", birth_date: "2026-05-28", today: "2026-10-28" };
    const altText = textOf(await runTool(alt, input, ctxWith()));
    const defaultText = textOf(await run(input));
    expect(altText).toContain("https://example.test/daycare");
    expect(altText).toContain("대체 제공자 링크");
    for (const u of DATA_URLS) {
      expect(altText).not.toContain(u);
    }
    const heads = (t: string): string[] => t.split("\n").filter((l) => l.startsWith("["));
    expect(heads(altText)).toEqual(heads(defaultText));

    const source = readFileSync(new URL("../src/tools/find-daycare.ts", import.meta.url), "utf8");
    expect(source).not.toContain("loadData");
    expect(source).not.toContain("daycare-guide");
    expect(source).not.toContain("fetch");
    expect(source).not.toContain("http:");
  });

  it("types and comparison", async () => {
    const text = textOf(await run({}));
    for (const name of ["국공립", "민간", "가정", "직장", "협동", "사회복지법인", "법인·단체 등"]) {
      expect(text).toContain(name);
    }
    for (const item of ["정원·현원", "교사 대 아동 비율", "CCTV", "행정처분 이력"]) {
      expect(text).toContain(item);
    }
  });

  it("stages", async () => {
    const today = "2026-10-28";
    const pregnancy = textOf(await run({ due_date: "2027-03-15", today }));
    expect(pregnancy).toContain("단계 임신 중");
    expect(pregnancy).toContain("확인 필요");

    const infant = textOf(await run({ birth_date: "2026-05-28", today }));
    expect(infant).toContain("생후 0~11개월");
    expect(infant).toContain("(생후 5개월)");

    const toddler = textOf(await run({ birth_date: "2025-08-28", today }));
    expect(toddler).toContain("생후 12~23개월");
    expect(toddler).toContain("(생후 14개월)");

    const general = textOf(await run({ today }));
    expect(general).toContain("아이 정보 없음(일반 안내)");

    const older = textOf(await run({ birth_date: "2023-01-10", today }));
    expect(older).toContain("만 3세 이상");
    expect(older).toContain("유치원알리미");
    expect(older).toContain("e-childschoolinfo");

    const sections = new Set([pregnancy, infant, toddler, general].map(waitlistSection));
    expect(sections.size).toBe(4);
    expect(pregnancy).not.toContain("신청할 수 있습니다");
    expect(pregnancy).not.toContain("신청 가능합니다");
  });

  it("deterministic snapshot", async () => {
    const input = { region: "성동구", birth_date: "2026-05-28", today: "2026-10-28" };
    const first = textOf(await run(input));
    const second = textOf(await run(input));
    expect(second).toBe(first);
    await expect(first).toMatchFileSnapshot("./__snapshots__/find-daycare-seongdong.txt");
  });

  it("today injection", async () => {
    const clockCtx = ctxWith({ clock: { now: () => new Date("2026-10-28T21:30:00+09:00") } });
    const implicit = textOf(await runTool(findDaycareTool, {}, clockCtx));
    expect(implicit).toContain("기준일 2026-10-28");
    const explicit = textOf(await runTool(findDaycareTool, { today: "2026-10-28" }, clockCtx));
    expect(implicit).toBe(explicit);
  });

  it("notices and wording", async () => {
    const scenarios: Record<string, unknown>[] = [
      {},
      { region: "성동구" },
      { region: "인천 서구" },
      { birth_date: "2026-05-28", today: "2026-10-28" },
      { due_date: "2027-03-15", today: "2026-10-28" },
      { birth_date: "2023-01-10", region: "경기도", today: "2026-10-28" },
    ];
    for (const input of scenarios) {
      const text = textOf(await run(input));
      expect(text).toContain("데이터를 조회하지 않으며");
      expect(text).toContain("비공식 도구");
      expect(text).toContain("최종 확인");
      expect(text).toContain("find_benefits");
      expect(text).toContain("보육");
      expect(text).toContain("get_timeline");
      expect(matchedPatterns(text, [DAYCARE_ASSERT])).toEqual([]);
      expect(matchedPatterns(text, OFFICIAL_CLAIM_OUTPUT)).toEqual([]);
    }
  });

  it("size cap keeps footer", async () => {
    const small = createTestContext({ env: { KPM_MAX_RESPONSE_CHARS: "1000" } });
    const res = await runTool(findDaycareTool, { region: "성동구", birth_date: "2026-05-28", today: "2026-10-28" }, small);
    const text = textOf(res);
    expect(text.length).toBeLessThanOrEqual(1000);
    expect(text).toContain("최종 확인");
    expect(text).toContain("공공기관이 제공하는 공개 API와 자료를 이용해 정리해 드려요.");

    const normal = createTestContext();
    const full = textOf(await runTool(findDaycareTool, {}, normal));
    expect(full.length).toBeLessThanOrEqual(normal.config.maxResponseChars);
    expect(full).not.toContain("자 생략");
  });
});
