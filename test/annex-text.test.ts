import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { extractPdfText, normalizeText } from "../scripts/lib/annex-text.js";
import { makeTextPdf } from "./helpers/pdf-fixture.js";

beforeAll(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error("global fetch disabled");
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("annex text", () => {
  it("extracts Korean lines in order", async () => {
    const result = await extractPdfText(makeTextPdf(["제1조 목적", "임산부 건강검진 기준", "ABC 123"]));
    expect(result).toEqual({ ok: true, truncated: false, text: "제1조 목적\n임산부 건강검진 기준\nABC 123" });
  });

  it("multi-page keeps order", async () => {
    const lines = Array.from({ length: 90 }, (_, i) => `항목 ${i}`);
    const result = await extractPdfText(makeTextPdf(lines, { linesPerPage: 40 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text.split("\n")).toEqual(lines);
  });

  it("empty page → no_text", async () => {
    expect(await extractPdfText(makeTextPdf([]))).toEqual({ ok: false, reason: "no_text" });
  });

  it("garbage → extract_failed", async () => {
    expect(await extractPdfText(Buffer.from("%PDF-1.4\nnot a pdf", "latin1"))).toEqual({
      ok: false,
      reason: "extract_failed",
    });
  });

  it("maxChars cuts on line boundary", async () => {
    const lines = Array.from({ length: 50 }, () => "가나다라마바사아자차");
    const result = await extractPdfText(makeTextPdf(lines), { maxChars: 100 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(100);
    for (const line of result.text.split("\n")) {
      expect(lines).toContain(line);
    }
  });

  it("normalizeText", () => {
    expect(normalizeText("  a\u0000b  \r\n\r\n  c‮   d  ")).toBe("ab\nc d");
    expect(normalizeText("한")).toBe("한");
  });
});
