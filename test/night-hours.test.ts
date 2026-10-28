import { describe, expect, it } from "vitest";
import {
  judgeOpen,
  kstMoment,
  mergeClinics,
  parseHhmm,
  parseNowInput,
  sortJudged,
  weekdaySlot,
  formatHhmm,
  type Clinic,
  type Judgement,
} from "../src/clinic/night-hours.js";

describe("night-hours", () => {
  it("parseNowInput accepts KST default", () => {
    expect(parseNowInput("2026-10-28T21:30")?.toISOString()).toBe("2026-10-28T12:30:00.000Z");
  });

  it("parseNowInput honors offset and Z", () => {
    const a = parseNowInput("2026-10-28T12:30:00Z");
    const b = parseNowInput("2026-10-28 21:30:00+0900");
    expect(a).toBeDefined();
    expect(b?.getTime()).toBe(a?.getTime());
  });

  it("parseNowInput rejects invalid", () => {
    for (const s of ["2026-02-30T10:00", "2026-10-28", "2026-10-28T24:00", "abc"]) {
      expect(parseNowInput(s)).toBeUndefined();
    }
  });

  it("kstMoment converts across UTC midnight", () => {
    const { date, minutes } = kstMoment(new Date("2026-10-27T15:30:00Z"));
    expect(date).toEqual({ y: 2026, m: 10, d: 28 });
    expect(minutes).toBe(30);
  });

  it("weekdaySlot maps Mon..Sun to 1..7", () => {
    const days = [26, 27, 28, 29, 30, 31];
    const slots = days.map((d) => weekdaySlot({ y: 2026, m: 10, d }));
    slots.push(weekdaySlot({ y: 2026, m: 11, d: 1 }));
    expect(slots).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("parseHhmm handles boundaries and malformed input", () => {
    expect(parseHhmm("0900")).toBe(540);
    expect(parseHhmm("2400")).toBe(1440);
    expect(parseHhmm("0000")).toBe(0);
    for (const v of ["2401", "2500", "9:00", "25AA", "", undefined]) {
      expect(parseHhmm(v)).toBeUndefined();
    }
    expect(formatHhmm(1440)).toBe("24:00");
    expect(formatHhmm(90)).toBe("01:30");
  });

  it("judgeOpen same-day range", () => {
    const item = { dutyTime3s: "0900", dutyTime3c: "1830" };
    expect(judgeOpen(item, 3, 2, 600, "화요일")).toEqual({ status: "진료 중", hoursText: "09:00~18:30" });
    expect(judgeOpen(item, 3, 2, 1110, "화요일").status).toBe("진료 시간 아님");
  });

  it("judgeOpen 2400 end", () => {
    const item = { dutyTime3s: "1800", dutyTime3c: "2400" };
    expect(judgeOpen(item, 3, 2, 1439, "화요일")).toEqual({ status: "진료 중", hoursText: "18:00~24:00" });
    expect(judgeOpen(item, 3, 2, 1079, "화요일").status).toBe("진료 시간 아님");
  });

  it("judgeOpen overnight today", () => {
    const item = { dutyTime3s: "2000", dutyTime3c: "0100" };
    const j = judgeOpen(item, 3, 2, 1410, "화요일");
    expect(j.status).toBe("진료 중");
    expect(j.hoursText).toContain("다음 날 01:00");
  });

  it("judgeOpen carried from previous day", () => {
    const item = {
      dutyTime2s: "2200",
      dutyTime2c: "0300",
      dutyTime3s: "0900",
      dutyTime3c: "1800",
    };
    const carried = judgeOpen(item, 3, 2, 30, "화요일");
    expect(carried.status).toBe("진료 중");
    expect(carried.carriedText).toContain("화요일");
    expect(carried.carriedText).toContain("03:00");
    expect(judgeOpen(item, 3, 2, 200, "화요일").status).toBe("진료 시간 아님");
  });

  it("judgeOpen missing or malformed is 확인 불가", () => {
    const missing = judgeOpen({}, 3, 2, 600, "화요일");
    expect(missing.status).toBe("확인 불가");
    expect(missing.hoursText).toBeUndefined();
    expect(judgeOpen({ dutyTime3s: "9:00", dutyTime3c: "25AA" }, 3, 2, 600, "화요일").status).toBe("확인 불가");
    const prevOvernight = { dutyTime2s: "2200", dutyTime2c: "0300" };
    expect(judgeOpen(prevOvernight, 3, 2, 30, "화요일").status).toBe("진료 중");
  });

  it("mergeClinics dedupes by hpid, moonlight wins", () => {
    const merged = mergeClinics(
      [{ hpid: "A1", dutyName: "X", dutyTime3s: "1800" }],
      [
        { hpid: "A1", dutyName: "X", dutyTime3s: "0900" },
        { hpid: "B2", dutyName: "Y" },
      ],
    );
    expect(merged).toHaveLength(2);
    expect(merged[0]?.kind).toBe("달빛어린이병원");
    expect(merged[0]?.item["dutyTime3s"]).toBe("1800");
    expect(merged[1]?.kind).toBe("소아청소년과");
  });

  it("mergeClinics falls back to name+address", () => {
    const merged = mergeClinics(
      [],
      [
        { dutyName: "Z", dutyAddr: "주소 1" },
        { dutyName: "Z", dutyAddr: "주소 1" },
      ],
    );
    expect(merged).toHaveLength(1);
  });

  it("sortJudged order", () => {
    const mk = (name: string, kind: Clinic["kind"], order: number, status: Judgement["status"]) => ({
      clinic: { key: name, name, kind, item: {}, order } as Clinic,
      judgement: { status } as Judgement,
    });
    const rows = [
      mk("소아진료시간아님", "소아청소년과", 0, "진료 시간 아님"),
      mk("소아확인불가", "소아청소년과", 1, "확인 불가"),
      mk("소아진료중", "소아청소년과", 2, "진료 중"),
      mk("달빛진료중", "달빛어린이병원", 3, "진료 중"),
    ];
    expect(sortJudged(rows).map((r) => r.clinic.name)).toEqual([
      "달빛진료중",
      "소아진료중",
      "소아확인불가",
      "소아진료시간아님",
    ]);
  });
});
