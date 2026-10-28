import { describe, expect, it } from "vitest";
import { settleWithin } from "../src/core/deadline.js";
import { ToolError } from "../src/core/errors.js";

const delayed = <T>(v: T, ms: number): Promise<T> => new Promise((resolve) => setTimeout(() => resolve(v), ms));

describe("settleWithin", () => {
  it("all resolve in order", async () => {
    const out = await settleWithin([Promise.resolve(1), delayed(2, 10)], 1000);
    expect(out).toEqual([
      { ok: true, value: 1 },
      { ok: true, value: 2 },
    ]);
  });

  it("rejection is captured", async () => {
    const out = await settleWithin<number>([Promise.reject(new Error("x")), Promise.resolve(2)], 1000);
    expect(out[0]!.ok).toBe(false);
    if (!out[0]!.ok) {
      expect(out[0]!.timedOut).toBe(false);
      expect((out[0]!.error as Error).message).toBe("x");
    }
  });

  it("pending task times out without waiting", async () => {
    const start = Date.now();
    const out = await settleWithin<number>([new Promise<number>(() => {}), Promise.resolve(2)], 30);
    expect(Date.now() - start).toBeLessThan(1000);
    expect(out[0]!.ok).toBe(false);
    if (!out[0]!.ok) {
      expect(out[0]!.timedOut).toBe(true);
      expect(out[0]!.error).toBeInstanceOf(ToolError);
      expect((out[0]!.error as ToolError).kind).toBe("TIMEOUT");
    }
    expect(out[1]).toEqual({ ok: true, value: 2 });
  });

  it("late settlement is ignored", async () => {
    const out = await settleWithin([delayed(1, 60)], 20);
    expect(out[0]!.ok).toBe(false);
    if (!out[0]!.ok) expect(out[0]!.timedOut).toBe(true);
    const snapshot = JSON.stringify(out.map((s) => (s.ok ? s.value : s.timedOut)));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(JSON.stringify(out.map((s) => (s.ok ? s.value : s.timedOut)))).toBe(snapshot);
  });
});
