import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadData } from "../src/data-store/load.js";
import type { BasisDoc } from "../src/data-store/schema.js";
import { autoCheckTargets, main, REASON_LABEL, type ReasonCategory } from "../scripts/check-revisions.js";
import type { ScriptIO } from "../scripts/lib/script-io.js";
import { createLawMock, sameAsStored, type LawRoute } from "./helpers/law-mock.js";

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

afterAll(() => {
  vi.unstubAllGlobals();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const dirs: string[] = [];

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "kpm-rev-"));
  dirs.push(d);
  return d;
}

const LAW_DOC = {
  id: "test-law",
  title: "테스트법",
  doc_no: "법률 제1호",
  kind: "law",
  url: "https://www.law.go.kr/test-law",
  as_of: "2026-01-01",
  effective: "2026-01-01",
  law_api: { kind: "law", law_name: "테스트법", mst: "100", effective: "2026-01-01" },
} as BasisDoc;

const ADM_DOC = {
  id: "test-adm",
  title: "테스트 고시",
  doc_no: "제2026-1호",
  kind: "admrul",
  url: "https://www.law.go.kr/test-adm",
  as_of: "2026-01-01",
  promulgated: "2026-01-01",
  law_api: { kind: "admrul", rule_id: null, name: "테스트 고시", serial: "1", number: "제2026-1호", issued: "2026-01-01" },
} as BasisDoc;

const NOBASE_DOC = {
  id: "test-nobase",
  title: "기준없음법",
  doc_no: "법률 제2호",
  kind: "law",
  url: "https://www.law.go.kr/test-nobase",
  as_of: "2026-01-01",
  effective: "2026-01-01",
  law_api: { kind: "law", law_name: "기준없음법" },
} as BasisDoc;

function serve(target: string, body: unknown): LawRoute {
  return (url) => (url.searchParams.get("target") === target ? jsonRes(body) : undefined);
}

function jsonRes(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json; charset=utf-8" } });
}

function htmlRes(): Response {
  return new Response("<!DOCTYPE html><html><body>오류</body></html>", {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function verificationRes(): Response {
  return new Response("<html>사용자 정보 검증에 실패하였습니다</html>", {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function lawBody(mst = "100", effective = "20260101", link = "/DRF/lawService.do?OC=test&target=law&MST=100&type=HTML") {
  return {
    LawSearch: {
      totalCnt: "1",
      law: [{ 법령명한글: "테스트법", 법령일련번호: mst, 법령ID: "TEST-LAW-1", 시행일자: effective, 법령상세링크: link }],
    },
  };
}

function admBody(number = "제2026-1호", serial = "1") {
  return {
    AdmRulSearch: {
      totalCnt: "1",
      admrul: [
        {
          행정규칙명: "테스트 고시",
          행정규칙일련번호: serial,
          행정규칙ID: "TEST-ADM-1",
          발령번호: number,
          발령일자: "20260101",
          상세링크: "/DRF/lawService.do?OC=test&target=admrul&ID=1&type=HTML",
        },
      ],
    },
  };
}

function harness(mock: { fetch: typeof fetch }, env: Record<string, string | undefined>) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io: ScriptIO = {
    env,
    fetch: mock.fetch,
    now: () => NOW,
    stdout: (text) => {
      stdout.push(text);
    },
    stderr: (text) => {
      stderr.push(text);
    },
  };
  return { io, stdout, stderr };
}

function expectOnly(text: string, key: ReasonCategory): void {
  expect(text).toContain(REASON_LABEL[key]);
  for (const other of Object.keys(REASON_LABEL) as ReasonCategory[]) {
    if (other !== key) expect(text).not.toContain(REASON_LABEL[other]);
  }
}

describe("check-revisions script", () => {
  it("changed → 10, writes issue body", async () => {
    const out = join(tmp(), "issue.md");
    const mock = createLawMock(serve("law", lawBody("200")), serve("admrul", admBody()));
    const h = harness(mock, { LAW_OC: OC });
    const code = await main(["--out", out], h.io, { docs: [LAW_DOC, ADM_DOC] });
    expect(code).toBe(10);
    expect(existsSync(out)).toBe(true);
    expect(readFileSync(out, "utf8")).toContain("테스트법");
  });

  it("all same → 0, no body", async () => {
    const out = join(tmp(), "issue.md");
    const mock = createLawMock(serve("law", lawBody()), serve("admrul", admBody()));
    const h = harness(mock, { LAW_OC: OC });
    const code = await main(["--out", out], h.io, { docs: [LAW_DOC, ADM_DOC] });
    expect(code).toBe(0);
    expect(h.stdout.join("")).toBe("");
    expect(existsSync(out)).toBe(false);
  });

  it("OC missing → 2 without fetch", async () => {
    const mock = createLawMock();
    const h = harness(mock, {});
    const code = await main([], h.io, { docs: [LAW_DOC] });
    expect(code).toBe(2);
    expect(mock.urls.length).toBe(0);
    expect(h.stderr.join("")).toContain(REASON_LABEL.oc_missing);
  });

  it("html 200 → 2 upstream", async () => {
    const mock = createLawMock(() => htmlRes());
    const h = harness(mock, { LAW_OC: OC });
    const code = await main([], h.io, { docs: [LAW_DOC] });
    expect(code).toBe(2);
    expectOnly(h.stderr.join(""), "upstream");
  });

  it("user verification failure → 2 not_approved", async () => {
    const mock = createLawMock(() => verificationRes());
    const h = harness(mock, { LAW_OC: OC });
    const code = await main([], h.io, { docs: [LAW_DOC] });
    expect(code).toBe(2);
    expectOnly(h.stderr.join(""), "not_approved");
  });

  it("no baseline → 2", async () => {
    const mock = createLawMock();
    const h = harness(mock, { LAW_OC: OC });
    const code = await main([], h.io, { docs: [NOBASE_DOC] });
    expect(code).toBe(2);
    expectOnly(h.stderr.join(""), "no_baseline");
  });

  it("labels are distinct", () => {
    expect(new Set(Object.values(REASON_LABEL)).size).toBe(Object.keys(REASON_LABEL).length);
  });

  it("changed + unavailable → 10", async () => {
    const mock = createLawMock(serve("law", lawBody("200")));
    const h = harness(mock, { LAW_OC: OC });
    const code = await main([], h.io, { docs: [LAW_DOC, NOBASE_DOC] });
    expect(code).toBe(10);
    expect(h.stdout.join("")).toContain("기준없음법");
  });

  it("targets every auto-check doc regardless of footer", async () => {
    const all = loadData("basis-documents").documents;
    const targets = autoCheckTargets(all);
    const mock = createLawMock(sameAsStored(OC));
    const h = harness(mock, { LAW_OC: OC });
    await main([], h.io);
    const text = h.stderr.join("");
    expect(text).toContain(`개정 확인 대상 ${targets.length}건`);
    for (const d of targets) expect(text).toContain(` ${d.id} (`);
    for (const d of all.filter((x) => x.law_api === null)) expect(text).not.toContain(` ${d.id} (`);
  });

  it("same input and time → identical body", async () => {
    const dir = tmp();
    const a = join(dir, "a.md");
    const b = join(dir, "b.md");
    for (const out of [a, b]) {
      const mock = createLawMock(serve("law", lawBody("200")), serve("admrul", admBody()));
      await main(["--out", out], harness(mock, { LAW_OC: OC }).io, { docs: [LAW_DOC, ADM_DOC, NOBASE_DOC] });
    }
    expect(readFileSync(a, "utf8")).toBe(readFileSync(b, "utf8"));
  });

  it("secrets never appear", async () => {
    const dir = tmp();
    const changedOut = join(dir, "changed.md");
    const texts: string[] = [];
    const scenarios: { routes: LawRoute[]; docs: BasisDoc[]; args: string[] }[] = [
      { routes: [serve("law", lawBody("200"))], docs: [LAW_DOC], args: ["--out", changedOut] },
      { routes: [() => verificationRes()], docs: [LAW_DOC], args: [] },
      { routes: [() => htmlRes()], docs: [LAW_DOC], args: [] },
    ];
    for (const s of scenarios) {
      const h = harness(createLawMock(...s.routes), { LAW_OC: OC });
      await main(s.args, h.io, { docs: s.docs });
      texts.push(h.stdout.join(""), h.stderr.join(""));
    }
    for (const f of readdirSync(dir)) texts.push(readFileSync(join(dir, f), "utf8"));
    const all = texts.join("\n");
    for (const form of FORMS(OC)) expect(all).not.toContain(form);
  });

  it("usage error → 1", async () => {
    const h = harness(createLawMock(), { LAW_OC: OC });
    const code = await main(["--bogus", "x"], h.io, { docs: [LAW_DOC] });
    expect(code).toBe(1);
    expect(h.stderr.join("")).toContain("사용법");
  });

  it("compiled CLI: no OC → exit 2", () => {
    const res = spawnSync(process.execPath, [join(root, "build-scripts/scripts/check-revisions.js")], {
      env: { PATH: process.env.PATH ?? "" },
      encoding: "utf8",
      cwd: root,
    });
    expect(res.status).toBe(2);
    expect(res.stderr).toContain(REASON_LABEL.oc_missing);
  });
});
