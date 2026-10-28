import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../scripts/record-sample.js";
import type { ScriptIO } from "../scripts/lib/script-io.js";
import { findLeaks, PLACEHOLDER_KEY } from "../scripts/lib/sample-mask.js";

const KEY = "FAKE+key/with==chars123";
const OC = "ocuser9";
const NOW = new Date("2026-10-28T00:00:00Z");
const dirs: string[] = [];

function xmlItems(n: number): string {
  const items = Array.from(
    { length: n },
    (_, i) => `<item><locdate>2026010${i + 1}</locdate><isHoliday>Y</isHoliday></item>`,
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><response><header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header><body><items>${items}</items><totalCount>${n}</totalCount></body></response>`;
}

interface Harness {
  io: ScriptIO;
  fetch: ReturnType<typeof vi.fn>;
  stdout: string[];
  stderr: string[];
}

function harness(env: Record<string, string | undefined>, body: string, status = 200, contentType = "application/xml"): Harness {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const fetch = vi.fn(async () => new Response(body, { status, headers: { "content-type": contentType } }));
  const io: ScriptIO = {
    env,
    fetch: fetch as unknown as typeof globalThis.fetch,
    now: () => NOW,
    stdout: (t) => {
      stdout.push(t);
    },
    stderr: (t) => {
      stderr.push(t);
    },
  };
  return { io, fetch, stdout, stderr };
}

function newRoot(): string {
  const d = mkdtempSync(join(tmpdir(), "rs-"));
  dirs.push(d);
  return d;
}

const ENV = { DATA_GO_KR_SERVICE_KEY: KEY, LAW_OC: OC };

beforeEach(() => {
  vi.clearAllMocks();
});

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("record-sample", () => {
  it("records masked kasi xml under dataset folder", async () => {
    const root = newRoot();
    const body = `${xmlItems(1)}<!-- raw ${KEY} enc ${encodeURIComponent(KEY)} -->`;
    const h = harness(ENV, body);
    const code = await main(["kasiHoliday", "solYear=2026", "--name", "y2026", "--max-items", "0"], h.io, { root });
    expect(code).toBe(0);
    const file = join(root, "test/fixtures/data-go-kr/kasiHoliday/y2026.xml");
    expect(existsSync(file)).toBe(true);
    expect(findLeaks(readFileSync(file, "utf8"), [KEY])).toEqual([]);
    const called = String(h.fetch.mock.calls[0]?.[0]);
    expect(new URL(called).searchParams.get("serviceKey")).toBe(KEY);
    expect(called).not.toContain("%25");
  });

  it("refuses to save when masking is skipped", async () => {
    const root = newRoot();
    const body = `${xmlItems(1)}<!-- raw ${KEY} -->`;
    const h = harness(ENV, body);
    const code = await main(["kasiHoliday", "solYear=2026", "--name", "y2026"], h.io, { root, mask: (t) => t });
    expect(code).toBe(2);
    expect(existsSync(join(root, "test/fixtures/data-go-kr/kasiHoliday/y2026.xml"))).toBe(false);
    const err = h.stderr.join("");
    expect(err).toContain("저장 거부");
    expect(err).not.toContain(KEY);
    expect(h.stdout.join("")).not.toContain(KEY);
  });

  it("does not call when fixture exists", async () => {
    const root = newRoot();
    const dir = join(root, "test/fixtures/data-go-kr/kasiHoliday");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "y2026.xml"), "<x/>", "utf8");
    const h = harness(ENV, xmlItems(1));
    const code = await main(["kasiHoliday", "solYear=2026", "--name", "y2026"], h.io, { root });
    expect(code).toBe(1);
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("law target uses lawSearch and OC", async () => {
    const root = newRoot();
    const body = JSON.stringify({
      AdmRulSearch: { admrul: [{ 행정규칙명: "건강검진 실시기준", 상세링크: `/DRF/lawService.do?OC=${OC}&ID=1` }] },
    });
    const h = harness(ENV, body, 200, "application/json");
    const code = await main(
      ["law:admrul", "query=건강검진 실시기준", "knd=3", "--name", "checkup"],
      h.io,
      { root },
    );
    expect(code).toBe(0);
    const url = new URL(String(h.fetch.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/DRF/lawSearch.do");
    expect(url.searchParams.get("target")).toBe("admrul");
    expect(url.searchParams.get("type")).toBe("JSON");
    expect(url.searchParams.get("OC")).toBe(OC);
    const saved = readFileSync(join(root, "test/fixtures/law/admrul/checkup.json"), "utf8");
    expect(saved).toContain("OC=***");
    expect(saved).not.toContain(OC);

    const h2 = harness(ENV, body, 200, "application/json");
    await main(["law:lawjosub", "ID=1", "JO=007400", "--name", "labor-074"], h2.io, { root });
    expect(new URL(String(h2.fetch.mock.calls[0]?.[0])).pathname).toBe("/DRF/lawService.do");
  });

  it("bad-key uses placeholder", async () => {
    const root = newRoot();
    const body = `<OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>30</returnReasonCode><returnAuthMsg>${PLACEHOLDER_KEY}</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>`;
    const h = harness({}, body);
    const code = await main(["nemcList", "--bad-key", "--name", "error-bad-key"], h.io, { root });
    expect(code).toBe(0);
    expect(new URL(String(h.fetch.mock.calls[0]?.[0])).searchParams.get("serviceKey")).toBe(PLACEHOLDER_KEY);
    const saved = readFileSync(join(root, "test/fixtures/data-go-kr/nemcList/error-bad-key.xml"), "utf8");
    expect(saved).toContain("***");
  });

  it("rejects missing key, unknown target, unsafe paths", async () => {
    const root = newRoot();
    const noKey = harness({}, xmlItems(1));
    expect(await main(["nemcList", "--name", "x"], noKey.io, { root })).toBe(1);
    expect(noKey.stderr.join("")).toContain("DATA_GO_KR_SERVICE_KEY");

    const h = harness(ENV, xmlItems(1));
    expect(await main(["vaccClinic", "--name", "x"], h.io, { root })).toBe(1);
    expect(await main(["nemcList", "--name", "x", "--out-file", "rel.json"], h.io, { root })).toBe(1);
    expect(await main(["nemcList", "--name", "x", "--out-file", join(root, "inside.json")], h.io, { root })).toBe(1);
    expect(await main(["nemcList", "--name", "x", "--note", "/etc/x.md"], h.io, { root })).toBe(1);
    expect(
      await main(
        ["url:https://example.com/a.do", "--key-env", "DATA_GO_KR_SERVICE_KEY", "--key-param", "serviceKey"],
        h.io,
        { root },
      ),
    ).toBe(1);
    expect(await main(["nemcList", "--name", "x", "--base", "http://evil.example"], h.io, { root })).toBe(1);
    expect(h.fetch).not.toHaveBeenCalled();
    expect(noKey.fetch).not.toHaveBeenCalled();
  });

  it("appends note block", async () => {
    const root = newRoot();
    const h = harness(ENV, xmlItems(1));
    const code = await main(
      ["kasiHoliday", "solYear=2026", "--name", "x", "--max-items", "0", "--note", ".docs/api-notes/x.md"],
      h.io,
      { root },
    );
    expect(code).toBe(0);
    const note = readFileSync(join(root, ".docs/api-notes/x.md"), "utf8");
    expect(note).toContain("### ");
    expect(note).toContain("분류: 확인됨");
    expect(note).not.toContain(KEY);
  });

  it("trims list to max items", async () => {
    const root = newRoot();
    const h = harness(ENV, xmlItems(5));
    const code = await main(["kasiHoliday", "solYear=2026", "--name", "trim"], h.io, { root });
    expect(code).toBe(0);
    const saved = readFileSync(join(root, "test/fixtures/data-go-kr/kasiHoliday/trim.xml"), "utf8");
    expect(saved.split("<item>").length - 1).toBe(3);
  });
});
