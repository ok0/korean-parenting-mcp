import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { BasisDoc } from "../src/data-store/schema.js";
import { main } from "../scripts/check-revisions.js";
import { ANNEX_LIMITS, ANNEX_REASON_TEXT, type AnnexFailReason, type AnnexLimits } from "../scripts/lib/annex-fetch.js";
import { ANNEX_BUDGET } from "../scripts/lib/annex-report.js";
import type { ScriptIO } from "../scripts/lib/script-io.js";
import { jsonRes } from "./helpers/law-mock.js";
import { binRes, HWP_BYTES, hangingFetchRes, makeTextPdf } from "./helpers/pdf-fixture.js";

const OC = "oc+te/st=1";
const NOW = new Date("2026-11-02T00:00:00Z");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function FORMS(x: string): string[] {
  return [x, encodeURIComponent(x), new URLSearchParams({ k: x }).toString().slice(2)];
}

beforeAll(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error("global fetch disabled");
  });
});

const dirs: string[] = [];

afterAll(() => {
  vi.unstubAllGlobals();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "kpm-annex-cli-"));
  dirs.push(d);
  return d;
}

const BYL_A = {
  id: "test-byl-a",
  title: "가법 시행규칙 별표 1",
  doc_no: "별표 1",
  kind: "licbyl",
  url: "https://www.law.go.kr/test-byl-a",
  as_of: "2026-01-01",
  promulgated: "2026-01-01",
  law_api: { kind: "licbyl", law_name: "가법 시행규칙", annex_no: "1", promulgation_no: "1" },
} as BasisDoc;

const BYL_B = {
  id: "test-byl-b",
  title: "나법 시행규칙 별표 1",
  doc_no: "별표 1",
  kind: "licbyl",
  url: "https://www.law.go.kr/test-byl-b",
  as_of: "2026-01-01",
  promulgated: "2026-01-01",
  law_api: { kind: "licbyl", law_name: "나법 시행규칙", annex_no: "1", promulgation_no: "1" },
} as BasisDoc;

type FileRoute = (init?: RequestInit) => Response | Promise<Response>;

interface Mock {
  fetch: typeof fetch;
  urls: string[];
}

function licbylRow(law: string, flSeq = "1", opts?: { noLinks?: boolean; no?: string }): Record<string, string> {
  const row: Record<string, string> = {
    별표번호: "0001",
    별표명: `(테스트) ${law} 별표 1`,
    관련법령명: law,
    공포번호: opts?.no ?? "2",
    별표법령상세링크: `/LSW/lsBylInfoP.do?OC=${encodeURIComponent(OC)}&bylSeq=${flSeq}`,
  };
  if (opts?.noLinks !== true) row.별표서식PDF파일링크 = `/LSW/flDownload.do?OC=${encodeURIComponent(OC)}&flSeq=${flSeq}`;
  return row;
}

function mockFetch(files: Record<string, FileRoute>, rows: Record<string, Record<string, string>>): Mock {
  const urls: string[] = [];
  const fake = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    urls.push(href);
    const url = new URL(href);
    if (url.pathname === "/LSW/flDownload.do") {
      const route = files[url.searchParams.get("flSeq") ?? ""];
      return route ? route(init) : new Response("not found", { status: 404 });
    }
    if (url.searchParams.get("target") === "licbyl") {
      const row = rows[url.searchParams.get("query") ?? ""];
      return row
        ? jsonRes({ LicBylSearch: { totalCnt: "1", licbyl: [row] } })
        : jsonRes({ LicBylSearch: { totalCnt: "0" } });
    }
    return jsonRes({ LawSearch: { totalCnt: "0" } });
  };
  return { fetch: fake as unknown as typeof fetch, urls };
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  body: string;
}

async function run(
  docs: readonly BasisDoc[],
  args: readonly string[],
  fetchImpl: typeof fetch,
  annexLimits?: Partial<AnnexLimits>,
): Promise<RunResult> {
  const out = join(tmp(), "issue.md");
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io: ScriptIO = {
    env: { LAW_OC: OC },
    fetch: fetchImpl,
    now: () => NOW,
    stdout: (text) => {
      stdout.push(text);
    },
    stderr: (text) => {
      stderr.push(text);
    },
  };
  const code = await main(["--out", out, ...args], io, { docs, annexLimits });
  return {
    code,
    stdout: stdout.join(""),
    stderr: stderr.join(""),
    body: existsSync(out) ? readFileSync(out, "utf8") : "",
  };
}

function gitStatus(): string {
  return execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: root, encoding: "utf8" });
}

const A_LINES = ["제1조 목적", "검사 항목 B"];
const A_BYTES = makeTextPdf(A_LINES);
const ROWS = {
  "가법 시행규칙": licbylRow("가법 시행규칙", "1"),
  "나법 시행규칙": licbylRow("나법 시행규칙", "2"),
};

describe("check-revisions annex diff", () => {
  it("diff against previous baseline", async () => {
    const base = tmp();
    writeFileSync(join(base, "test-byl-a.txt"), "제1조 목적\n검사 항목 A\n");
    const mock = mockFetch({ "1": () => binRes(A_BYTES) }, { "가법 시행규칙": ROWS["가법 시행규칙"] });
    const r = await run([BYL_A], ["--baseline-dir", base], mock.fetch);
    expect(r.code).toBe(10);
    expect(r.body).toContain("## 첨부 텍스트 비교");
    expect(r.body).toContain("```diff");
    expect(r.body).toContain("-검사 항목 A");
    expect(r.body).toContain("+검사 항목 B");
    expect(readFileSync(join(base, "test-byl-a.txt"), "utf8")).toContain("검사 항목 B");
  });

  it("no baseline → 비교 기준 없음 with excerpt", async () => {
    const mock = mockFetch({ "1": () => binRes(A_BYTES) }, { "가법 시행규칙": ROWS["가법 시행규칙"] });
    const r = await run([BYL_A], ["--baseline-dir", tmp()], mock.fetch);
    expect(r.code).toBe(10);
    expect(r.body).toContain("비교 기준 없음");
    expect(r.body).toMatch(/`{3,}text\n[\s\S]*검사 항목 B/);
  });

  const FAIL_CASES: { reason: AnnexFailReason; file?: FileRoute; noLinks?: boolean; limits?: Partial<AnnexLimits> }[] = [
    { reason: "hwp", file: () => binRes(HWP_BYTES) },
    { reason: "no_text", file: () => binRes(makeTextPdf([])) },
    { reason: "download_failed", file: () => binRes(new Uint8Array(0), { status: 500 }) },
    { reason: "blocked", file: () => binRes(new Uint8Array(0), { status: 403 }) },
    { reason: "timeout", file: (init) => hangingFetchRes(init), limits: { timeoutMs: 100 } },
    { reason: "no_url", noLinks: true },
    {
      reason: "too_large",
      file: () => binRes(new Uint8Array(A_BYTES.byteLength * 3), { withLength: true }),
      limits: { maxBytes: A_BYTES.byteLength + 16 },
    },
  ];

  it.each(FAIL_CASES)("extraction failure $reason is reported and exit stays 10", async (c) => {
    const files: Record<string, FileRoute> = { "1": () => binRes(A_BYTES) };
    if (c.file !== undefined) files["2"] = c.file;
    const mock = mockFetch(files, {
      "가법 시행규칙": ROWS["가법 시행규칙"],
      "나법 시행규칙": licbylRow("나법 시행규칙", "2", { noLinks: c.noLinks }),
    });
    const r = await run([BYL_A, BYL_B], [], mock.fetch, c.limits);
    expect(r.code).toBe(10);
    expect(r.body).toContain("추출 불가");
    expect(r.body).toContain(ANNEX_REASON_TEXT[c.reason]);
    for (const other of Object.keys(ANNEX_REASON_TEXT) as AnnexFailReason[]) {
      if (other !== c.reason) expect(r.body).not.toContain(ANNEX_REASON_TEXT[other]);
    }
    const link =
      c.reason === "no_url" ? "https://www.law.go.kr/LSW/lsBylInfoP.do?bylSeq=2" : "https://www.law.go.kr/LSW/flDownload.do?flSeq=2";
    expect(r.body).toContain(link);
    expect(r.body).toContain("검사 항목 B");
  });

  it("large text stays under caps and is byte-identical", async () => {
    const pdf = makeTextPdf(Array.from({ length: 3000 }, (_, i) => `항목 ${i}`));
    const prior = `${Array.from({ length: 3000 }, (_, i) => `이전 ${i}`).join("\n")}\n`;
    const bodies: string[] = [];
    for (let k = 0; k < 2; k++) {
      const base = tmp();
      writeFileSync(join(base, "test-byl-a.txt"), prior);
      writeFileSync(join(base, "test-byl-b.txt"), prior);
      const mock = mockFetch(
        { "1": () => binRes(pdf), "2": () => binRes(pdf) },
        { "가법 시행규칙": ROWS["가법 시행규칙"], "나법 시행규칙": ROWS["나법 시행규칙"] },
      );
      const r = await run([BYL_A, BYL_B], ["--baseline-dir", base], mock.fetch);
      expect(r.code).toBe(10);
      expect(r.body.length).toBeLessThanOrEqual(ANNEX_BUDGET.bodyMaxChars);
      expect(r.body.length).toBeLessThan(65536);
      expect(r.body).toContain("잘림:");
      bodies.push(r.body);
    }
    expect(bodies[0]).toBe(bodies[1]);
  }, 60000);

  it("baseline lives outside the repo", async () => {
    const before = gitStatus();
    const base = tmp();
    expect(base.startsWith(root)).toBe(false);
    const mock = mockFetch({ "1": () => binRes(A_BYTES) }, { "가법 시행규칙": ROWS["가법 시행규칙"] });
    const r = await run([BYL_A], ["--baseline-dir", base], mock.fetch);
    expect(r.code).toBe(10);
    expect(existsSync(join(base, "test-byl-a.txt"))).toBe(true);
    expect(gitStatus()).toBe(before);
  });

  it("OC never leaks", async () => {
    const pdf = makeTextPdf(["제1조 목적", `키 ${OC}`]);
    const base = tmp();
    writeFileSync(join(base, "test-byl-a.txt"), "제1조 목적\n이전\n");
    const mock = mockFetch(
      { "1": () => binRes(pdf), "2": () => binRes(new Uint8Array(0), { status: 403 }) },
      { "가법 시행규칙": ROWS["가법 시행규칙"], "나법 시행규칙": ROWS["나법 시행규칙"] },
    );
    const r = await run([BYL_A, BYL_B], ["--baseline-dir", base], mock.fetch);
    const files = readdirSync(base).map((f) => readFileSync(join(base, f), "utf8"));
    const all = [r.stdout, r.stderr, r.body, ...files].join("\n");
    for (const form of FORMS(OC)) expect(all).not.toContain(form);
    const downloads = mock.urls.filter((u) => u.includes("/LSW/flDownload.do"));
    expect(downloads.length).toBeGreaterThan(0);
    for (const u of downloads) expect(u).not.toMatch(/[?&]oc=/i);
  });

  it("untrusted text stays fenced", async () => {
    const lines = ["```", "<img src=x onerror=alert(1)>", "@admin", "## 가짜 제목"];
    const mock = mockFetch({ "1": () => binRes(makeTextPdf(lines)) }, { "가법 시행규칙": ROWS["가법 시행규칙"] });
    const r = await run([BYL_A], [], mock.fetch);
    expect(r.code).toBe(10);
    const all = r.body.split("\n");
    const open = all.findIndex((l) => /^`{4,}text$/.test(l));
    expect(open).toBeGreaterThanOrEqual(0);
    const fence = (all[open] ?? "").slice(0, -"text".length);
    const close = all.indexOf(fence, open + 1);
    expect(close).toBeGreaterThan(open);
    const inside = all.slice(open + 1, close);
    for (const l of lines) expect(inside).toContain(l);
    const outside = [...all.slice(0, open), ...all.slice(close + 1)];
    expect(outside.some((l) => l.startsWith("## 가짜 제목") || l.startsWith("<img"))).toBe(false);
  });

  it("exit 0 downloads nothing", async () => {
    const base = tmp();
    const mock = mockFetch(
      { "1": () => binRes(A_BYTES) },
      { "가법 시행규칙": licbylRow("가법 시행규칙", "1", { no: "1" }) },
    );
    const r = await run([BYL_A], ["--baseline-dir", base], mock.fetch);
    expect(r.code).toBe(0);
    expect(mock.urls.filter((u) => u.includes("/LSW/flDownload.do")).length).toBe(0);
    expect(readdirSync(base).length).toBe(0);
  });

  it("baseline write failure keeps exit 10", async () => {
    const filePath = join(tmp(), "not-a-dir");
    writeFileSync(filePath, "x");
    const mock = mockFetch({ "1": () => binRes(A_BYTES) }, { "가법 시행규칙": ROWS["가법 시행규칙"] });
    const r = await run([BYL_A], ["--baseline-dir", filePath], mock.fetch);
    expect(r.code).toBe(10);
    expect(r.stderr).toContain("첨부 기준 텍스트 저장 실패");
    expect(r.body).toContain("## 첨부 텍스트 비교");
  });
});
