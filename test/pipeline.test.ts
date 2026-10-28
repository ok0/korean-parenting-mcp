import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ACTIONS } from "../src/core/errors.js";
import { finalize, findOversizedArg, runTool } from "../src/core/pipeline.js";
import { createTestContext } from "./helpers/context.js";
import {
  defaultMaxTool,
  echoTool,
  keyTool,
  leakTool,
  longTool,
  throwTool,
  upstreamTool,
} from "./helpers/fixture-tools.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function textOf(res: { content: { type: "text"; text: string }[] }): string {
  return res.content[0]!.text;
}

async function expectRecovers(ctx: ReturnType<typeof createTestContext>): Promise<void> {
  const res = await runTool(echoTool, { text: "hi" }, ctx);
  expect(res.isError).toBeUndefined();
  expect(textOf(res)).toBe("hi");
}

describe("runTool input guards", () => {
  it("rejects string over 2000 chars", async () => {
    const ctx = createTestContext();
    const res = await runTool(echoTool, { text: "a".repeat(2001) }, ctx);
    const text = textOf(res);
    expect(res.isError).toBe(true);
    expect(text).toContain("BAD_INPUT");
    expect(text).toContain("text");
    expect(text).toContain("2000");
    expect(text).toContain("조치:");
    await expectRecovers(ctx);
  });

  it("2000 char string passes size stage and fails schema max", async () => {
    const res = await runTool(echoTool, { text: "a".repeat(2000) }, createTestContext());
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("입력 검증 실패");
  });

  it("rejects depth over 5", async () => {
    const ctx = createTestContext();
    const deep = await runTool(echoTool, { text: "hi", n: { a: { b: { c: { d: {} } } } } }, ctx);
    expect(deep.isError).toBe(true);
    expect(textOf(deep)).toContain("중첩 깊이");
    await expectRecovers(ctx);

    const ok = await runTool(echoTool, { text: "hi", n: { a: { b: { c: {} } } } }, ctx);
    expect(ok.isError).toBeUndefined();
    expect(textOf(ok)).toBe("hi");
  });

  it("rejects more than 50 keys", async () => {
    const ctx = createTestContext();
    const many = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}`, 1]));
    const bad = await runTool(echoTool, { text: "hi", ...many }, ctx);
    expect(bad.isError).toBe(true);
    expect(textOf(bad)).toContain("항목 수");
    await expectRecovers(ctx);

    const few = Object.fromEntries(Array.from({ length: 49 }, (_, i) => [`k${i}`, 1]));
    const ok = await runTool(echoTool, { text: "hi", ...few }, ctx);
    expect(ok.isError).toBeUndefined();
    expect(textOf(ok)).toBe("hi");
  });

  it("schema failure lists field path", async () => {
    const ctx = createTestContext();
    const res = await runTool(echoTool, { text: 123 }, ctx);
    const text = textOf(res);
    expect(res.isError).toBe(true);
    expect(text).toContain("입력 검증 실패");
    expect(text).toContain("- text:");
    expect(text).toContain("describe");
    await expectRecovers(ctx);

    const count = await runTool(echoTool, { text: "hi", count: "9" }, ctx);
    expect(count.isError).toBe(true);
    expect(textOf(count)).toContain("- count:");
  });

  it("accepts numeric strings for int fields", async () => {
    const res = await runTool(echoTool, { text: "ab", count: "2" }, createTestContext());
    expect(res.isError).toBeUndefined();
    expect(textOf(res)).toBe("abab");
  });
});

describe("runTool errors", () => {
  it("missing key", async () => {
    const res = await runTool(keyTool, {}, createTestContext());
    const text = textOf(res);
    expect(res.isError).toBe(true);
    expect(text).toContain("MISSING_KEY");
    expect(text).toContain("DATA_GO_KR_SERVICE_KEY");
    expect(text).toContain("https://www.data.go.kr");
    expect(text).toContain("Decoding");

    const ok = await runTool(keyTool, {}, createTestContext({ env: { DATA_GO_KR_SERVICE_KEY: "abcd1234" } }));
    expect(ok.isError).toBeUndefined();
    expect(textOf(ok)).toBe("ok");
  });

  it("handler exception becomes INTERNAL", async () => {
    const ctx = createTestContext();
    const res = await runTool(throwTool, {}, ctx);
    const text = textOf(res);
    expect(res.isError).toBe(true);
    expect(text).toContain("INTERNAL");
    expect(text).toContain("boom");
    expect(text).toContain("조치:");
    await expectRecovers(ctx);
  });

  it("ToolError kind preserved", async () => {
    const ctx = createTestContext();
    const res = await runTool(upstreamTool, {}, ctx);
    const text = textOf(res);
    expect(res.isError).toBe(true);
    expect(text).toContain("UPSTREAM");
    expect(text).toContain(DEFAULT_ACTIONS.UPSTREAM[0]!);
    await expectRecovers(ctx);
  });
});

describe("runTool truncation", () => {
  it("truncates body only, keeps footer", async () => {
    const res = await runTool(longTool, {}, createTestContext());
    const text = textOf(res);
    expect(text.length).toBeLessThanOrEqual(1000);
    expect(text.endsWith("\n\n출처: 테스트 데이터 · 면책: 참고용")).toBe(true);
    expect(text).toContain("자 생략");
  });

  it("no truncation under limit", async () => {
    const res = await runTool(echoTool, { text: "hi" }, createTestContext());
    expect(textOf(res)).toBe("hi");
  });

  it("uses config maxResponseChars by default", async () => {
    const res = await runTool(defaultMaxTool, {}, createTestContext({ env: { KPM_MAX_RESPONSE_CHARS: "1000" } }));
    const text = textOf(res);
    expect(text.length).toBeLessThanOrEqual(1000);
    expect(text).toContain("자 생략");
  });

  it("finalize unit", () => {
    expect(finalize({ body: "x".repeat(10), footer: "F" }, 1000, [])).toBe("xxxxxxxxxx\n\nF");
  });
});

describe("runTool key masking", () => {
  it("never leaks keys", async () => {
    const K = "Ab+cD/eF=gH+iJ/kL==";
    const forms = [K, encodeURIComponent(K), new URLSearchParams({ x: K }).toString().slice(2)];
    const env = {
      DATA_GO_KR_SERVICE_KEY: K,
      KINDERGARTEN_API_KEY: "Kg+/=kinder1",
      LAW_OC: "law_oc_val",
    };
    const stderrWrites: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
      stderrWrites.push(String(chunk));
      return true;
    });

    for (const mode of ["body", "footer", "throw", "toolerror", "log"] as const) {
      const logLines: string[] = [];
      const ctx = createTestContext({ env, sink: (line) => logLines.push(line) });
      const res = await runTool(leakTool, { mode }, ctx);
      const text = textOf(res);
      const all = [text, ...logLines, ...stderrWrites].join("\n");

      for (const f of forms) expect(all).not.toContain(f);
      expect(all).toContain("***");
      if (mode === "throw" || mode === "toolerror") expect(res.isError).toBe(true);
    }
  });
});

describe("findOversizedArg", () => {
  it("returns null for small inputs", () => {
    expect(findOversizedArg({ a: "x" })).toBeNull();
    expect(findOversizedArg(undefined)).toBeNull();
  });

  it("reports string reason", () => {
    expect(findOversizedArg({ a: "x".repeat(2001) })?.reason).toBe("string");
  });

  it("reports depth reason", () => {
    expect(findOversizedArg({ n: { a: { b: { c: { d: {} } } } } })?.reason).toBe("depth");
  });

  it("reports keys reason", () => {
    const many = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`k${i}`, 1]));
    expect(findOversizedArg(many)?.reason).toBe("keys");
  });
});
