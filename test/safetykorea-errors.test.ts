import { describe, expect, it } from "vitest";
import { SAFETYKOREA_KEY_ACTIONS, safetyKoreaError } from "../src/core/errors.js";

describe("safetyKoreaError", () => {
  it("4000 → KEY_INVALID with SafetyKorea key actions", () => {
    const e = safetyKoreaError("4000");
    expect(e.kind).toBe("KEY_INVALID");
    expect(e.message).toContain("4000");
    const actions = e.actions.join();
    expect(actions).toContain("SAFETYKOREA_AUTH_KEY");
    expect(actions).toContain("AuthKey");
    expect(actions).not.toContain("Decoding");
    expect(actions).not.toContain("공공데이터포털");
    expect(e.detail?.code).toBe("4000");
  });

  it("4001 → NOT_APPROVED asking to check registered access info and approval without asserting fixed IP", () => {
    const e = safetyKoreaError("4001");
    expect(e.kind).toBe("NOT_APPROVED");
    const actions = e.actions.join();
    expect(actions).toContain("승인");
    expect(actions).toContain("등록");
    expect(actions).toContain("IP");
    const all = e.message + actions;
    expect(all).not.toContain("고정 IP");
    expect(all).not.toContain("고정IP");
    expect(all).not.toContain("필요");
    expect(all).not.toContain("공공데이터포털");
  });

  it("4005, 5000 and unknown codes → UPSTREAM including the code", () => {
    for (const code of ["4005", "5000", "9999"]) {
      const e = safetyKoreaError(code);
      expect(e.kind).toBe("UPSTREAM");
      expect(e.message).toContain(code);
    }
  });

  it("KEY_INVALID, NOT_APPROVED and UPSTREAM texts differ", () => {
    const texts = ["4000", "4001", "5000"].map((c) => {
      const e = safetyKoreaError(c);
      return e.message + e.actions.join();
    });
    expect(new Set(texts).size).toBe(3);
    expect(SAFETYKOREA_KEY_ACTIONS).toEqual(safetyKoreaError("4000").actions);
  });
});
