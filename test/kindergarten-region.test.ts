import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { kindergartenQuery, normalizeRegion, type KindergartenQuery } from "../src/region/normalize.js";
import { loadData } from "../src/data-store/load.js";

function ok(input: string): KindergartenQuery {
  const r = normalizeRegion(input);
  if (!r.ok) throw new Error(`normalizeRegion failed: ${input}`);
  return kindergartenQuery(r.region);
}

describe("kindergartenQuery", () => {
  it("seongdong and yeongtong map to sido/sgg codes", () => {
    const seongdong = ok("성동구");
    expect(seongdong).toMatchObject({ ok: true, sidoCode: "11", sggCode: "11200" });
    expect(seongdong.ok && seongdong.label).toContain("성동구");

    const yeongtong = ok("수원 영통구");
    expect(yeongtong).toMatchObject({ ok: true, sidoCode: "41", sggCode: "41117" });
  });

  it("sejong resolves from sido name", () => {
    expect(ok("세종")).toMatchObject({ ok: true, sidoCode: "36", sggCode: "36110" });
  });

  it("parent city without code lists child districts", () => {
    const goyang = ok("고양시");
    expect(goyang).toMatchObject({ ok: false, reason: "no-code" });
    expect(goyang.ok === false && goyang.candidates.map((c) => c.sigungu)).toEqual([
      "고양시 덕양구",
      "고양시 일산동구",
      "고양시 일산서구",
    ]);

    const bucheon = ok("부천");
    expect(bucheon.ok === false && bucheon.candidates).toHaveLength(3);

    const hwaseong = ok("화성시");
    expect(hwaseong.ok === false && hwaseong.candidates).toHaveLength(4);
  });

  it("sido only is guidance", () => {
    const seoul = ok("서울");
    expect(seoul).toMatchObject({ ok: false, reason: "sido-only", label: "서울특별시" });
  });

  it("every coded district follows the 2+5 digit rule", () => {
    const data = loadData("regions");
    const sidoName = (code: string): string => {
      const s = data.sido.find((x) => x.code === code);
      if (!s) throw new Error(`unknown sido ${code}`);
      return s.name;
    };

    const uncoded: string[] = [];
    for (const g of data.sigungu) {
      if (g.codes.kindergarten === undefined) {
        uncoded.push(g.code);
        continue;
      }
      expect(
        kindergartenQuery({ sido: sidoName(g.sido_code), sigungu: g.name, code: g.code }),
      ).toMatchObject({ ok: true, sidoCode: g.code.slice(0, 2), sggCode: g.code });
    }

    expect(uncoded).toHaveLength(8);
    expect(new Set(uncoded)).toEqual(
      new Set(["41190", "41270", "41280", "41460", "41590", "43110", "44130", "52110"]),
    );
    for (const code of uncoded) {
      const g = data.sigungu.find((x) => x.code === code);
      if (!g) throw new Error(`missing ${code}`);
      const q = kindergartenQuery({ sido: sidoName(g.sido_code), sigungu: g.name, code: g.code });
      expect(q).toMatchObject({ ok: false, reason: "no-code" });
      expect(q.ok === false && q.candidates.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("probe fixture rows belong to seongdong", () => {
    const body = JSON.parse(
      readFileSync(new URL("./fixtures/kindergarten/basicInfo2.json", import.meta.url), "utf8"),
    ) as { kinderInfo: { addr: string }[] };
    expect(body.kinderInfo.length).toBeGreaterThan(0);
    for (const row of body.kinderInfo) {
      expect(row.addr.startsWith("서울특별시 성동구 ")).toBe(true);
    }
  });
});
