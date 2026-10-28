import { describe, expect, it } from "vitest";
import { callKindergartenBasic, KG_SUSPECT_ROWS } from "../src/clients/kindergarten.js";
import { ToolError } from "../src/core/errors.js";
import {
  createKgMock,
  hangUntilAbort,
  KG_KEY_FORMS,
  KG_PATH,
  KG_TEST_KEY,
  kgBody,
  kgCtx,
  kgFx,
  kgMany,
  kgRes,
} from "./helpers/kg-mock.js";

const Q = { sidoCode: "11", sggCode: "11200" };
const DAY_MS = 24 * 60 * 60 * 1000;

async function catchErr(p: Promise<unknown>): Promise<ToolError> {
  try {
    await p;
  } catch (err) {
    if (err instanceof ToolError) return err;
    throw err;
  }
  throw new Error("expected ToolError");
}

describe("callKindergartenBasic", () => {
  it("sends the key once with region codes and no paging", async () => {
    const mock = createKgMock();
    const res = await callKindergartenBasic(Q, kgCtx(mock));
    expect(mock.calls).toHaveLength(1);
    const u = mock.calls[0] as URL;
    expect(u.protocol).toBe("https:");
    expect(u.hostname).toBe("e-childschoolinfo.moe.go.kr");
    expect(u.pathname).toBe(KG_PATH);
    expect(u.searchParams.getAll("key")).toEqual([KG_TEST_KEY]);
    expect(u.searchParams.get("sidoCode")).toBe("11");
    expect(u.searchParams.get("sggCode")).toBe("11200");
    expect(u.searchParams.get("pageCnt")).toBeNull();
    expect(u.searchParams.get("currentPage")).toBeNull();
    expect(u.searchParams.get("timing")).toBeNull();
    const encodedOnce = new URLSearchParams({ x: KG_TEST_KEY }).toString().slice(2);
    expect(u.search.split(encodedOnce).length - 1).toBe(1);
    expect(u.search).not.toContain(encodeURIComponent(encodeURIComponent(KG_TEST_KEY)));
    expect(res.items).toHaveLength(5);
  });

  it("accepts JSON served as text/html and as application/json", async () => {
    const asHtml = await callKindergartenBasic(Q, kgCtx(createKgMock()));
    expect(asHtml.items).toHaveLength(5);
    const asJson = await callKindergartenBasic(
      Q,
      kgCtx(createKgMock(() => kgRes(kgFx("basicInfo2.json"), 200, "application/json"))),
    );
    expect(asJson.items).toHaveLength(5);
  });

  it("maps DENIED to key invalid", async () => {
    const err = await catchErr(callKindergartenBasic(Q, kgCtx(createKgMock(() => kgRes(kgFx("denied.json"))))));
    expect(err.kind).toBe("KEY_INVALID");
    expect(err.message).toContain("유효하지 않은 키");
    expect(err.message).toContain("DENIED");
    expect(err.actions.join("\n")).toContain("KINDERGARTEN_API_KEY");
    const forbidden = await catchErr(callKindergartenBasic(Q, kgCtx(createKgMock(() => kgRes("", 403)))));
    expect(forbidden.kind).toBe("KEY_INVALID");
  });

  it("maps upstream failures to distinct messages", async () => {
    const cases: [() => Response, string][] = [
      [() => kgRes(kgFx("error.json")), "ERROR"],
      [() => kgRes(kgFx("error-page.html")), "웹 페이지(HTML)"],
      [() => kgRes("<r><a>1</a></r>", 200, "application/xml"), "JSON 형식이 아닙니다"],
      [() => kgRes("{broken"), "해석하지 못했습니다"],
      [() => kgRes(kgFx("no-list.json")), "kinderInfo"],
      [() => kgRes(kgFx("error-page.html"), 500), "HTTP 500"],
    ];
    const messages: string[] = [];
    for (const [route, needle] of cases) {
      const err = await catchErr(callKindergartenBasic(Q, kgCtx(createKgMock(route))));
      expect(err.kind).toBe("UPSTREAM");
      expect(err.actions[0]).toContain("다시 시도");
      expect(err.message).toContain(needle);
      messages.push(err.message);
    }
    expect(new Set(messages).size).toBe(6);
  });

  it("empty list is not an error", async () => {
    const r = await callKindergartenBasic(Q, kgCtx(createKgMock(() => kgRes(kgFx("empty.json")))));
    expect(r.items).toEqual([]);
    expect(r.suspectCapped).toBe(false);
  });

  it("flags suspect cap at 100 rows", async () => {
    const atCap = await callKindergartenBasic(
      Q,
      kgCtx(createKgMock(() => kgRes(kgBody(kgMany(KG_SUSPECT_ROWS))))),
    );
    expect(atCap.suspectCapped).toBe(true);
    const belowCap = await callKindergartenBasic(Q, kgCtx(createKgMock(() => kgRes(kgBody(kgMany(99))))));
    expect(belowCap.suspectCapped).toBe(false);
  });

  it("caches by region codes and expires after a day", async () => {
    let now = new Date("2026-10-28T21:30:00+09:00");
    const mock = createKgMock();
    const ctx = kgCtx(mock, { now: () => now });
    await callKindergartenBasic(Q, ctx);
    const second = await callKindergartenBasic(Q, ctx);
    expect(mock.count()).toBe(1);
    expect(second.fromCache).toBe(true);
    await callKindergartenBasic({ sidoCode: "41", sggCode: "41117" }, ctx);
    expect(mock.count()).toBe(2);
    now = new Date(now.getTime() + DAY_MS + 1);
    await callKindergartenBasic(Q, ctx);
    expect(mock.count()).toBe(3);
  });

  it("missing key means no fetch", async () => {
    const mock = createKgMock();
    const err = await catchErr(callKindergartenBasic(Q, kgCtx(mock, { env: { KINDERGARTEN_API_KEY: "" } })));
    expect(err.kind).toBe("MISSING_KEY");
    expect(mock.count()).toBe(0);
  });

  it("times out with the standard timeout error", async () => {
    const err = await catchErr(
      callKindergartenBasic(
        Q,
        kgCtx(createKgMock((_u, init) => hangUntilAbort(init)), { config: { httpTimeoutMs: 50 } }),
      ),
    );
    expect(err.kind).toBe("TIMEOUT");
  });

  it("never logs key or region codes", async () => {
    const logs: string[] = [];
    const sink = (line: string): void => {
      logs.push(line);
    };
    await callKindergartenBasic(Q, kgCtx(createKgMock(), { sink }));
    await catchErr(callKindergartenBasic(Q, kgCtx(createKgMock(() => kgRes(kgFx("denied.json"))), { sink })));
    await catchErr(callKindergartenBasic(Q, kgCtx(createKgMock(() => kgRes(kgFx("error.json"))), { sink })));
    const all = logs.join("\n");
    expect(logs.length).toBeGreaterThan(0);
    for (const form of KG_KEY_FORMS) expect(all).not.toContain(form);
    expect(all).not.toContain("11200");
  });
});
