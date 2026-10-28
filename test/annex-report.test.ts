import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { BasisDoc } from "../src/data-store/schema.js";
import type { RevisionStatus } from "../src/provenance/revision-check.js";
import { ANNEX_LIMITS } from "../scripts/lib/annex-fetch.js";
import {
  assembleIssueBody,
  type AnnexResult,
  collectAnnexes,
  readBaseline,
  writeBaselines,
} from "../scripts/lib/annex-report.js";
import { makeTextPdf, PNG_BYTES } from "./helpers/pdf-fixture.js";

beforeAll(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error("global fetch disabled");
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

const DOC = {
  id: "test-byl",
  title: "테스트법 시행규칙 별표 1",
  doc_no: "별표 1",
  kind: "licbyl",
  url: "https://www.law.go.kr/test-byl",
  as_of: "2026-01-01",
  law_api: null,
} as unknown as BasisDoc;

const CHANGED: RevisionStatus = {
  basisId: "test-byl",
  state: "changed",
  message: "x",
  link: "https://www.law.go.kr/LSW/lsBylInfoP.do?bylSeq=1",
  attachment: { pdfLink: "https://www.law.go.kr/LSW/flDownload.do?flSeq=111" },
};

const MASK = (t: string): string => t;
const LIMITS = { ...ANNEX_LIMITS };

function fetchReturning(bytes: Uint8Array, contentType: string): typeof fetch {
  return (async () =>
    new Response(bytes, { status: 200, headers: { "content-type": contentType } })) as unknown as typeof fetch;
}

describe("annex report", () => {
  const dir = mkdtempSync(join(tmpdir(), "kpm-annex-"));

  it("baseline round trip and unsafe ids ignored", () => {
    const results: AnnexResult[] = [
      {
        basisId: "test-byl",
        title: DOC.title,
        pageLink: "https://www.law.go.kr/x",
        kind: "text",
        text: "제1조 목적\n항목 1",
        textTruncated: false,
      },
    ];
    expect(writeBaselines(dir, results, MASK)).toBe(1);
    expect(readBaseline(dir, "test-byl", 1000)).toBe("제1조 목적\n항목 1");
    expect(readBaseline(dir, "../x", 1000)).toBeUndefined();
  });

  it("collect skips non-changed and never throws", async () => {
    const log = (): void => undefined;
    const confirmed: RevisionStatus = { basisId: "test-byl", state: "confirmed", message: "ok" };
    const none = await collectAnnexes([confirmed], [DOC], { fetch: fetch, limits: LIMITS, mask: MASK, log });
    expect(none).toEqual([]);

    const throwing = (() => {
      throw new Error("boom");
    }) as unknown as typeof fetch;
    const thrown = await collectAnnexes([CHANGED], [DOC], { fetch: throwing, limits: LIMITS, mask: MASK, log });
    expect(thrown).toHaveLength(1);
    expect(thrown[0]).toMatchObject({ kind: "unavailable", reason: "download_failed" });

    const html = await collectAnnexes([CHANGED], [DOC], {
      fetch: fetchReturning(new TextEncoder().encode("<html>x</html>"), "text/html"),
      limits: LIMITS,
      mask: MASK,
      log,
    });
    expect(html[0]).toMatchObject({ kind: "unavailable", reason: "blocked" });

    const png = await collectAnnexes([CHANGED], [DOC], {
      fetch: fetchReturning(PNG_BYTES, "image/png"),
      limits: LIMITS,
      mask: MASK,
      log,
    });
    expect(png[0]).toMatchObject({ kind: "unavailable", reason: "unsupported" });

    const pdf = await collectAnnexes([CHANGED], [DOC], {
      fetch: fetchReturning(makeTextPdf(["제1조 목적"]), "application/pdf"),
      limits: LIMITS,
      mask: MASK,
      log,
    });
    expect(pdf[0]).toMatchObject({ kind: "text", text: "제1조 목적", textTruncated: false });
  });

  it("assemble keeps base and caps size", () => {
    const base = "BASE\n";
    const long = (tag: string): AnnexResult => ({
      basisId: `doc-${tag}`,
      title: `문서 ${tag}`,
      pageLink: "https://www.law.go.kr/x",
      kind: "text",
      text: Array.from({ length: 5000 }, (_, i) => `항목 ${i} 내용`).join("\n"),
      textTruncated: false,
    });
    const body = assembleIssueBody(base, [long("a"), long("b")]);
    expect(body.startsWith("BASE\n")).toBe(true);
    expect(body.length).toBeLessThanOrEqual(60000);
    expect(body).toContain("잘림:");
    const blocks = body.split("### ");
    for (const block of blocks.slice(1)) {
      expect(block.length).toBeLessThanOrEqual(12000 + 200);
    }
  });

  it("assemble is deterministic", () => {
    const input: AnnexResult[] = [
      {
        basisId: "test-byl",
        title: DOC.title,
        pageLink: "https://www.law.go.kr/x",
        kind: "text",
        text: "가\n나\n다",
        textTruncated: false,
        previous: "가\n라\n다",
      },
    ];
    expect(assembleIssueBody("BASE\n", input)).toEqual(assembleIssueBody("BASE\n", input));
  });
});
