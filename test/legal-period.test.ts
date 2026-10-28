import { describe, expect, it } from "vitest";
import { formatDate, parseDate, type CivilDate } from "../src/date/civil-date.js";
import { bundledCalendar, createCalendar } from "../src/date/holiday-calendar.js";
import { computeDeadline, type PeriodRule } from "../src/date/legal-period.js";

const cal = bundledCalendar();

function rule(unit: "day" | "month", amount: number, countFirstDay: boolean, extend: boolean): PeriodRule {
  return { unit, amount, countFirstDay, extendIfNonWorking: extend };
}

function run(event: string, r: PeriodRule, calendar = cal) {
  return computeDeadline(parseDate(event), r, calendar);
}

describe("computeDeadline — 월 단위 (민법 제160조)", () => {
  it("month,1,true,false: 말일 보정 포함", () => {
    expect(formatDate(run("2026-03-10", rule("month", 1, true, false)).end)).toBe("2026-04-09");
    expect(formatDate(run("2026-01-31", rule("month", 1, true, false)).end)).toBe("2026-02-28");
    expect(formatDate(run("2028-01-31", rule("month", 1, true, false)).end)).toBe("2028-02-29");
  });

  it("month,1,false: 초일 불산입", () => {
    expect(formatDate(run("2026-03-10", rule("month", 1, false, false)).end)).toBe("2026-04-10");
  });
});

describe("computeDeadline — 일 단위", () => {
  it("day,60,true: 초일 산입", () => {
    expect(formatDate(run("2026-01-10", rule("day", 60, true, false)).end)).toBe("2026-03-10");
  });

  it("day,60,false: 초일 불산입", () => {
    expect(formatDate(run("2026-01-10", rule("day", 60, false, false)).end)).toBe("2026-03-11");
  });
});

describe("computeDeadline — 비근무일 연장 (민법 제161조)", () => {
  it("토요일·일요일 마감은 다음 근무일로 연장", () => {
    const sat = run("2026-11-07", rule("day", 1, true, true));
    expect(formatDate(sat.end)).toBe("2026-11-09");
    expect(formatDate(sat.extendedFrom as CivilDate)).toBe("2026-11-07");

    const sun = run("2026-11-08", rule("day", 1, true, true));
    expect(formatDate(sun.end)).toBe("2026-11-09");
    expect(formatDate(sun.extendedFrom as CivilDate)).toBe("2026-11-08");
  });

  it("연휴 연속 시 첫 근무일까지 연장", () => {
    const chuseok = run("2026-09-24", rule("day", 1, true, true));
    expect(formatDate(chuseok.end)).toBe("2026-09-28");
    expect(formatDate(chuseok.extendedFrom as CivilDate)).toBe("2026-09-24");
    expect(chuseok.holidayDataMissing).toBe(false);

    const gaechun = run("2026-10-03", rule("day", 1, true, true));
    expect(formatDate(gaechun.end)).toBe("2026-10-06");
    expect(gaechun.holidayDataMissing).toBe(false);

    const march = run("2026-03-01", rule("day", 1, true, true));
    expect(formatDate(march.end)).toBe("2026-03-03");
    expect(march.holidayDataMissing).toBe(false);

    const monthly = run("2026-08-25", rule("month", 1, true, true));
    expect(formatDate(monthly.end)).toBe("2026-09-28");
    expect(monthly.holidayDataMissing).toBe(false);
  });

  it("extendIfNonWorking false면 연장하지 않음", () => {
    const result = run("2026-09-24", rule("day", 1, true, false));
    expect(formatDate(result.end)).toBe("2026-09-24");
    expect(result.extendedFrom).toBeUndefined();
  });

  it("근무일이면 extendedFrom 키를 만들지 않음", () => {
    const result = run("2026-11-10", rule("day", 1, true, true));
    expect(formatDate(result.end)).toBe("2026-11-10");
    expect(Object.hasOwn(result, "extendedFrom")).toBe(false);
  });

  it("주입 달력의 임시공휴일 반영", () => {
    const injected = createCalendar({
      2026: { source: "live", entries: [{ date: "2026-11-10", name: "임시공휴일" }] },
    });
    expect(formatDate(run("2026-11-10", rule("day", 1, true, true), injected).end)).toBe("2026-11-11");
  });
});

describe("computeDeadline — 데이터 누락 플래그", () => {
  it("데이터가 없는 연도는 holidayDataMissing true", () => {
    const sat = run("2028-01-01", rule("day", 1, true, true));
    expect(formatDate(sat.end)).toBe("2028-01-03");
    expect(formatDate(sat.extendedFrom as CivilDate)).toBe("2028-01-01");
    expect(sat.holidayDataMissing).toBe(true);

    const march = run("2028-03-01", rule("day", 1, true, true));
    expect(formatDate(march.end)).toBe("2028-03-01");
    expect(Object.hasOwn(march, "extendedFrom")).toBe(false);
    expect(march.holidayDataMissing).toBe(true);
  });

  it("연장 옵션이 꺼져 있으면 데이터 누락 플래그는 false", () => {
    expect(run("2028-01-01", rule("day", 1, true, false)).holidayDataMissing).toBe(false);
  });
});

describe("computeDeadline — 입력 검증과 결정성", () => {
  it("기간 수량은 1 이상의 정수여야 함", () => {
    expect(() => run("2026-03-10", rule("day", 0, true, false))).toThrow(RangeError);
    expect(() => run("2026-03-10", rule("day", 1.5, true, false))).toThrow(RangeError);
  });

  it("같은 입력은 같은 결과", () => {
    const r = rule("day", 1, true, true);
    expect(run("2026-09-24", r)).toEqual(run("2026-09-24", r));
  });
});
