import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  ANNEX_REASON_TEXT,
  downloadAttachment,
  safeAttachmentUrl,
  sniffFormat,
} from "../scripts/lib/annex-fetch.js";
import { binRes, chunkedRes, HWP_BYTES, hangingFetchRes, makeTextPdf, PNG_BYTES } from "./helpers/pdf-fixture.js";

beforeAll(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error("global fetch disabled");
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

function fetchOf(fn: (url: string, init?: RequestInit) => Promise<Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchFn = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push({ url, init });
    return fn(url, init);
  };
  return { fetchFn: fetchFn as typeof fetch, calls };
}

const LIMITS = { maxBytes: 10_485_760, timeoutMs: 5_000 };

describe("annex fetch", () => {
  it("safeAttachmentUrl strips OC and forces https law.go.kr", () => {
    expect(safeAttachmentUrl("/LSW/flDownload.do?OC=x&flSeq=1")?.href).toBe(
      "https://www.law.go.kr/LSW/flDownload.do?flSeq=1",
    );
    expect(safeAttachmentUrl("http://www.law.go.kr/a?oc=1&b=2")?.href).toBe("https://www.law.go.kr/a?b=2");
    expect(safeAttachmentUrl("https://evil.test/a")).toBeUndefined();
    expect(safeAttachmentUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeAttachmentUrl("")).toBeUndefined();
    expect(safeAttachmentUrl(undefined)).toBeUndefined();
  });

  it("sniffFormat", () => {
    expect(sniffFormat(makeTextPdf(["a"]), "")).toBe("pdf");
    expect(sniffFormat(HWP_BYTES, "")).toBe("hwp");
    expect(sniffFormat(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]), "")).toBe("hwp");
    expect(sniffFormat(PNG_BYTES, "")).toBe("image");
    expect(sniffFormat(new TextEncoder().encode("  <!DOCTYPE html>"), "")).toBe("html");
    expect(sniffFormat(new Uint8Array([1, 2, 3, 4]), "text/html; charset=utf-8")).toBe("html");
    expect(sniffFormat(new TextEncoder().encode("abc"), "")).toBe("unknown");
  });

  it("download ok", async () => {
    const pdf = makeTextPdf(["제1조 목적"]);
    const { fetchFn, calls } = fetchOf(async () => binRes(pdf));
    const url = new URL("https://www.law.go.kr/LSW/flDownload.do?flSeq=1");
    const result = await downloadAttachment(url, fetchFn, LIMITS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bytes.byteLength).toBe(pdf.byteLength);
    expect(calls[0]?.init?.signal).toBeDefined();
  });

  it("401/403 blocked, 500 download_failed, throw download_failed", async () => {
    const url = new URL("https://www.law.go.kr/LSW/flDownload.do?flSeq=1");
    for (const status of [401, 403]) {
      const { fetchFn } = fetchOf(async () => binRes(new Uint8Array(4), { status }));
      expect(await downloadAttachment(url, fetchFn, LIMITS)).toEqual({ ok: false, reason: "blocked" });
    }
    const server = fetchOf(async () => binRes(new Uint8Array(4), { status: 500 }));
    expect(await downloadAttachment(url, server.fetchFn, LIMITS)).toEqual({ ok: false, reason: "download_failed" });
    const thrower = fetchOf(async () => {
      throw new Error("socket reset");
    });
    expect(await downloadAttachment(url, thrower.fetchFn, LIMITS)).toEqual({ ok: false, reason: "download_failed" });
  });

  it("timeout", async () => {
    const url = new URL("https://www.law.go.kr/LSW/flDownload.do?flSeq=1");
    const { fetchFn } = fetchOf((_url, init) => hangingFetchRes(init));
    expect(await downloadAttachment(url, fetchFn, { maxBytes: LIMITS.maxBytes, timeoutMs: 50 })).toEqual({
      ok: false,
      reason: "timeout",
    });
  });

  it("content-length over cap", async () => {
    const url = new URL("https://www.law.go.kr/LSW/flDownload.do?flSeq=1");
    const { fetchFn } = fetchOf(async () => binRes(new Uint8Array(2048), { withLength: true }));
    expect(await downloadAttachment(url, fetchFn, { maxBytes: 1024, timeoutMs: 5_000 })).toEqual({
      ok: false,
      reason: "too_large",
    });
  });

  it("streamed body over cap", async () => {
    const url = new URL("https://www.law.go.kr/LSW/flDownload.do?flSeq=1");
    const { fetchFn } = fetchOf(async () => chunkedRes(4096, 512));
    expect(await downloadAttachment(url, fetchFn, { maxBytes: 1024, timeoutMs: 5_000 })).toEqual({
      ok: false,
      reason: "too_large",
    });
  });

  it("redirect to foreign host blocked", async () => {
    const url = new URL("https://www.law.go.kr/LSW/flDownload.do?flSeq=1");
    const { fetchFn } = fetchOf(async () => {
      const res = binRes(new Uint8Array(4));
      Object.defineProperty(res, "url", { value: "https://evil.test/x" });
      return res;
    });
    expect(await downloadAttachment(url, fetchFn, LIMITS)).toEqual({ ok: false, reason: "blocked" });
  });

  it("reason texts are distinct", () => {
    expect(new Set(Object.values(ANNEX_REASON_TEXT)).size).toBe(9);
  });
});
