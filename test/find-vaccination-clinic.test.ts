import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ClinicLinkProvider } from "../src/clinic/guide.js";
import { pickWindows, vaccineWindows } from "../src/clinic/stage.js";
import type { ToolContext } from "../src/core/context.js";
import { runTool } from "../src/core/pipeline.js";
import { parseDate } from "../src/date/civil-date.js";
import { loadData } from "../src/data-store/load.js";
import { createFindVaccinationClinicTool, findVaccinationClinicTool } from "../src/tools/find-vaccination-clinic.js";
import { itemLine } from "../src/tools/shared/clinic-text.js";
import { OBSERVED_CLINIC_URLS, URL_RE } from "./helpers/clinic-urls.js";
import { createTestContext } from "./helpers/context.js";
import { CLINIC_ASSERT, OFFICIAL_CLAIM_OUTPUT, matchedPatterns } from "./helpers/wording.js";

const fetchSpy = vi.fn(async (): Promise<Response> => {
  throw new Error("network disabled");
});

function ctxWith(extra: Partial<ToolContext> = {}): ToolContext {
  return { ...createTestContext(), fetch: fetchSpy as unknown as ToolContext["fetch"], ...extra };
}

async function run(args: Record<string, unknown>, ctx: ToolContext = ctxWith()) {
  return runTool(findVaccinationClinicTool, args, ctx);
}

function textOf(res: { content: { type: "text"; text: string }[] }): string {
  return res.content[0]!.text;
}

const T = "2026-10-28";
const B5 = { region: "성동구", birth_date: "2026-05-28", today: T };

afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled();
  fetchSpy.mockClear();
});

describe("find_vaccination_clinic", () => {
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
    const res = await runTool(findVaccinationClinicTool, { region: "성동구" }, createTestContext({ env: {} }));
    expect(res.isError).toBeFalsy();
  });

  it("region normalized", async () => {
    const seongdong = textOf(await run({ region: "성동구" }));
    expect(seongdong).toContain("시도 '서울특별시' → 시군구 '성동구'");
    expect(seongdong).toContain("서울특별시 성동구 보건소");

    const gyeonggi = textOf(await run({ region: "경기도" }));
    expect(gyeonggi).toContain("시도 '경기도'를 선택");
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
    expect(text).toContain(OBSERVED_CLINIC_URLS.vaccination[0]);
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
        expect(OBSERVED_CLINIC_URLS.vaccination).toContain(u);
      }
    }
    expect(all).toContain("goVcntMngm.do?menuCd=336&menuLv=3");
    expect(all).toContain("goVcntInfo.do?menuLv=1&menuCd=115");
    expect(all).toContain("보건소 탭");
    expect(all).toContain("1339");
    expect(all).toContain("확인 필요");
    expect(all).not.toContain("sido=");
    expect(all).not.toContain("sigungu=");
    expect(all).not.toContain("region=");
  });

  it("call first and prepare", async () => {
    const text = textOf(await run(B5));
    expect(text).toContain("방문 전 해당 의료기관에 전화로 접종 가능 백신·재고");
    expect(text.indexOf("[먼저 전화로 확인]")).toBeLessThan(text.indexOf("[링크]"));
    expect(text).toContain("예방접종 수첩");
    expect(text).toContain("보호자 신분증");
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

  it("stage birth 5 months", async () => {
    const text = textOf(await run(B5));
    expect(text).toContain("생후 5개월");
    expect(text).toContain("지금 기간 중인 차수: 없음");
    expect(text).toContain("DTaP 2차 (4개월): 2026-09-28~2026-10-27");
    expect(text).toContain("다음 접종 시기: 2026-11-28");
    expect(text).toContain("DTaP 3차 (6개월): 2026-11-28~2026-12-27");

    const next = pickWindows(vaccineWindows(parseDate("2026-05-28")), parseDate(T)).next;
    expect(next.length).toBeGreaterThan(0);
    for (const i of next) expect(text).toContain(itemLine(i));

    expect(text).toContain("출처: 표준예방접종일정표(2026, 어린이)");
    if (loadData("vaccinations").vaccines.some((v) => v.verified === "false")) expect(text).toContain("미검증");
    expect(text).toContain("지침 원문 확인 필요");
    expect(text).toContain("로타바이러스 접종 월령 한도");
  });

  it("stage current", async () => {
    const text = textOf(await run({ birth_date: "2025-10-28", today: T }));
    expect(text).toContain("생후 12개월");
    expect(text).toContain("MMR 1차 (12~15개월): 2026-10-28~2027-02-27");
    expect(text).not.toContain("지금 기간 중인 차수: 없음");
  });

  it("stage due and none differ", async () => {
    const due = textOf(await run({ due_date: "2027-03-15", today: T }));
    expect(due).toContain("출산 전(출산예정일 2027-03-15)");
    expect(due).toContain("BCG(결핵) 1차 (생후 4주 이내)");
    expect(due).toContain("B형간염 1차 (출생 시)");
    expect(due).toContain("출생 후 접종 일정은 출생 후 안내합니다");

    const none = textOf(await run({ today: T }));
    expect(none).toContain("아이 정보 없음(일반 안내)");
    expect(none).toContain("맞춤 안내");

    const block = (t: string): string => t.split("\n\n").find((b) => b.startsWith("[아이 단계 정보")) ?? "";
    const sections = new Set([block(textOf(await run(B5))), block(due), block(none)]);
    expect(sections.size).toBe(3);
  });

  it("provider boundary", async () => {
    const fake: ClinicLinkProvider = {
      links: () => [
        {
          id: "fake",
          label: "대체 제공자 링크",
          url: "https://example.test/vacc",
          purpose: "테스트",
          source: "테스트 출처",
          as_of: "2026-01-01",
          verified: "false",
          region_param: "unverified",
        },
      ],
    };
    const alt = createFindVaccinationClinicTool(fake);
    expect(alt.name).toBe("find_vaccination_clinic");
    expect(JSON.stringify(z.toJSONSchema(alt.schema))).toBe(JSON.stringify(z.toJSONSchema(findVaccinationClinicTool.schema)));

    const altText = textOf(await runTool(alt, B5, ctxWith()));
    const defaultText = textOf(await run(B5));
    expect(altText).toContain("https://example.test/vacc");
    expect(altText).toContain("대체 제공자 링크");
    for (const u of OBSERVED_CLINIC_URLS.vaccination) {
      expect(altText).not.toContain(u);
    }
    const heads = (t: string): string[] => t.split("\n").filter((l) => l.startsWith("["));
    expect(heads(altText)).toEqual(heads(defaultText));

    const source = readFileSync(new URL("../src/tools/find-vaccination-clinic.ts", import.meta.url), "utf8");
    expect(source).not.toContain("loadData");
    expect(source).not.toContain("clinic-guide");
    expect(source).not.toContain("fetch");
    expect(source).not.toContain("http:");
  });

  it("deterministic snapshot", async () => {
    const first = textOf(await run(B5));
    const second = textOf(await run(B5));
    expect(second).toBe(first);
    await expect(first).toMatchFileSnapshot("./__snapshots__/find-vaccination-clinic-seongdong.txt");
  });

  it("today injection", async () => {
    const clockCtx = ctxWith({ clock: { now: () => new Date("2026-10-28T21:30:00+09:00") } });
    const implicit = textOf(await runTool(findVaccinationClinicTool, {}, clockCtx));
    expect(implicit).toContain("기준일 2026-10-28");
    const explicit = textOf(await runTool(findVaccinationClinicTool, { today: T }, clockCtx));
    expect(implicit).toBe(explicit);
  });

  it("notices and wording", async () => {
    const scenarios: Record<string, unknown>[] = [
      {},
      { region: "성동구" },
      { region: "인천 서구" },
      B5,
      { due_date: "2027-03-15", today: T },
      { birth_date: "2025-10-28", region: "경기도", today: T },
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
    const ctx = ctxWith({ log: createTestContext({ sink: (l) => lines.push(l) }).log });
    await runTool(findVaccinationClinicTool, B5, ctx);
    const logged = lines.join("\n");
    expect(logged).not.toContain("성동구");
    expect(logged).not.toContain("2026-05-28");
  });

  it("size cap keeps footer", async () => {
    const small = createTestContext({ env: { KPM_MAX_RESPONSE_CHARS: "1000" } });
    const text = textOf(await runTool(findVaccinationClinicTool, B5, small));
    expect(text.length).toBeLessThanOrEqual(1000);
    expect(text).toContain("최종 확인");
    expect(text).toContain("의료 면책");
    expect(text).toContain("비공식 도구 고지");

    const normal = createTestContext();
    const full = textOf(await runTool(findVaccinationClinicTool, {}, normal));
    expect(full.length).toBeLessThanOrEqual(normal.config.maxResponseChars);
    expect(full).not.toContain("자 생략");
  });
});
