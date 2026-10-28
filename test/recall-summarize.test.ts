import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SkService } from "../src/clients/safetykorea.js";
import { CHILD_KEYWORDS, compareRows, dedupeRows, isChildText, toRecallRow, type RecallRow } from "../src/recall/summarize.js";

function rowsOf(name: string): Record<string, unknown>[] {
  const doc = JSON.parse(readFileSync(new URL(`./fixtures/safetykorea/${name}.json`, import.meta.url), "utf8")) as { resultData: Record<string, unknown>[] };
  return doc.resultData;
}

function firstRow(service: SkService, name: string): RecallRow {
  return toRecallRow(service, rowsOf(name)[0]!);
}

describe("recall row mapping", () => {
  it("maps recallList", () => {
    const r = firstRow("recallList", "recallList");
    expect(r.uid).toBe("3802");
    expect(r.product).toBe("가정용섬유제품(책가방)");
    expect(r.brand).toBe("JJ");
    expect(r.company).toBe("(주)이랜드월드패션사업부");
    expect(r.date).toBe("2013-04-18");
    expect(r.kind).toBe("명령에따른리콜");
    expect(r.contact).toBe("080-023-0456");
    expect(r.reason).toBeUndefined();
    expect(r.url).toBeUndefined();
    expect(r.child).toBe(false);
  });

  it("maps fRecallList", () => {
    const r = firstRow("fRecallList", "fRecallList");
    expect(r.reason).toBe("작은 부품이 떨어질 수 있어 유아 질식 위험");
    expect(r.publisher).toBe("국외 > 유럽지역 > 프랑스 · 유럽 집행위원회");
    expect(r.url).toBeUndefined();
    expect(r.child).toBe(true);
  });

  it("maps overseasList", () => {
    const r = firstRow("overseasList", "overseasList");
    expect(r.brand).toBeUndefined();
    expect(r.reason).toContain("카드뮴 71 mg/kg");
    expect(r.reason).toContain("신장");
    expect(r.reason).not.toContain("\n");
    expect(r.child).toBe(false);
  });

  it("maps certificationList", () => {
    const r = firstRow("certificationList", "certificationList");
    expect(r.uid).toBe("1231231");
    expect(typeof r.uid).toBe("string");
    expect(r.date).toBe("2019-07-17");
    expect(r.certState).toBe("적합");
    expect(r.child).toBe(true);
  });

  it("key without uid", () => {
    const item = { ...rowsOf("recallList")[0]! };
    delete item.recallUid;
    const r = toRecallRow("recallList", item);
    expect(r.key).toBe("recallList|가정용섬유제품(책가방)|2013-04-18");
  });
});

describe("dedupe and ordering", () => {
  it("dedupeRows keeps first", () => {
    const a = firstRow("recallList", "recallList");
    const a2 = { ...a, product: "다른 제품" };
    const b = { ...a, uid: "9999", key: "recallList#9999", product: "또 다른 제품" };
    const out = dedupeRows([a, a2, b]);
    expect(out).toHaveLength(2);
    expect(out[0]!.product).toBe(a.product);
  });

  it("compareRows orders by date desc, then service, then key", () => {
    const base = firstRow("recallList", "recallList");
    const newer: RecallRow = { ...base, date: "2026-05-19", key: "recallList#1" };
    const older: RecallRow = { ...base, date: "2019-07-17", key: "certificationList#1", service: "certificationList" };
    const undated: RecallRow = { ...base, date: undefined, key: "recallList#0" };
    expect([undated, older, newer].sort(compareRows)).toEqual([newer, older, undated]);

    const rl: RecallRow = { ...base, date: "2020-01-01", service: "recallList", key: "recallList#5" };
    const os: RecallRow = { ...base, date: "2020-01-01", service: "overseasList", key: "overseasList#1" };
    expect(compareRows(rl, os)).toBeLessThan(0);

    const k1: RecallRow = { ...base, date: "2020-01-01", service: "recallList", key: "recallList#1" };
    const k2: RecallRow = { ...base, date: "2020-01-01", service: "recallList", key: "recallList#2" };
    expect(compareRows(k1, k2)).toBeLessThan(0);
  });
});

describe("isChildText", () => {
  it("matches child keywords case and width insensitively", () => {
    expect(isChildText(["KIDS 의자"])).toBe(true);
    expect(isChildText(["베이비 로션"])).toBe(true);
    expect(isChildText([undefined, "유모차"])).toBe(true);
    expect(isChildText(["건전지"])).toBe(false);
  });

  it("CHILD_KEYWORDS includes the required terms", () => {
    for (const k of ["유아", "영유아", "아동", "어린이", "키즈", "베이비"]) {
      expect(CHILD_KEYWORDS).toContain(k);
    }
  });
});
