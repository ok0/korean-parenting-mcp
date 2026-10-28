import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../src/core/context.js";
import { KEY_GUIDE } from "../src/core/errors.js";
import { runTool } from "../src/core/pipeline.js";
import { loadData, resolveBasis } from "../src/data-store/load.js";
import { toJo } from "../src/clients/law.js";
import { getLeaveArticleTool } from "../src/tools/get-leave-article.js";
import { createTestContext } from "./helpers/context.js";
import { createLawMock, htmlRes, jsonRes, type LawRoute } from "./helpers/law-mock.js";

const FAKE = "ab+c/d=e1";
const ENCODED_FAKE = encodeURIComponent(FAKE);

type Topic = "spouse_leave" | "maternity_leave" | "parental_leave";
const TOPICS: { topic: Topic; label: string; jo: string }[] = [
  { topic: "spouse_leave", label: "제18조의2", jo: "001802" },
  { topic: "maternity_leave", label: "제74조", jo: "007400" },
  { topic: "parental_leave", label: "제19조", jo: "001900" },
];

function readJson(relative: string): Record<string, unknown> {
  return JSON.parse(readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8")) as Record<string, unknown>;
}

const LAW_SEARCH = readJson("./fixtures/law/law-search.json") as { LawSearch: { law: Record<string, string>[] } };
const LAWJOSUB_074 = readJson("./fixtures/law/lawjosub-074.json");

function lawNameOf(topic: Topic): string {
  const a = loadData("leave").articles[topic];
  const doc = resolveBasis(a.basis_ids)[0]!;
  if (doc.law_api?.kind !== "law") throw new Error("fixture: law_api가 law가 아님");
  return doc.law_api.law_name;
}

function basisUrlOf(topic: Topic): string {
  const a = loadData("leave").articles[topic];
  return resolveBasis(a.basis_ids)[0]!.url;
}

function standardRoutes(name: string, article: unknown = LAWJOSUB_074): LawRoute[] {
  const row = { ...LAW_SEARCH.LawSearch.law[0]!, 법령명한글: name };
  return [
    (url) => (url.searchParams.get("target") === "law" ? jsonRes({ LawSearch: { totalCnt: "1", law: [row] } }) : undefined),
    (url) => (url.searchParams.get("target") === "lawjosub" ? jsonRes(article) : undefined),
  ];
}

function ctxOf(
  fetchFn: typeof fetch,
  opts: { env?: Record<string, string>; sink?: (line: string) => void; httpTimeoutMs?: number } = {},
): ToolContext {
  const base = createTestContext({ env: opts.env ?? { LAW_OC: FAKE }, sink: opts.sink });
  return {
    ...base,
    fetch: fetchFn,
    config: { ...base.config, httpTimeoutMs: opts.httpTimeoutMs ?? base.config.httpTimeoutMs },
  };
}

const call = (topic: string, ctx: ToolContext) => runTool(getLeaveArticleTool, { topic }, ctx);
const text = (r: { content: { type: string; text?: string }[] }): string => r.content[0]!.text ?? "";

describe("get_leave_article", () => {
  it("keyless call: MISSING_KEY with LAW_OC guidance, no fetch", async () => {
    const spy = vi.fn(async () => jsonRes({}));
    const ctx = ctxOf(spy as unknown as typeof fetch, { env: {} });
    const r = await call("maternity_leave", ctx);
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("LAW_OC");
    expect(text(r)).toContain("open.law.go.kr");
    expect(text(r)).toContain("get_leave_article");
    expect(spy).toHaveBeenCalledTimes(0);
    expect(KEY_GUIDE.LAW_OC.tools).toContain("get_leave_article");
  });

  it("each topic prints article", async () => {
    for (const { topic, label, jo } of TOPICS) {
      const name = lawNameOf(topic);
      const mock = createLawMock(...standardRoutes(name));
      const r = await call(topic, ctxOf(mock.fetch));
      expect(r.isError, topic).toBeFalsy();
      const t = text(r);
      for (const s of [
        name,
        label,
        "(테스트) 조문 제목",
        "① 테스트 fixture 항 1",
        "1. 테스트 fixture 호 1",
        "공포일자 2026-04-07",
        "조문시행일자 2026-10-08",
        "법제처 국가법령정보센터",
        "조회 시각 2026-01-01 00:00",
        "법적 효력이 없고",
        "비공식",
      ]) {
        expect(t, `${topic}: ${s}`).toContain(s);
      }
      const lawjosubUrl = mock.urls.map((u) => new URL(u)).find((u) => u.searchParams.get("target") === "lawjosub");
      expect(lawjosubUrl?.searchParams.get("JO")).toBe(jo);
      expect(jo).toBe(toJo(loadData("leave").articles[topic].article, loadData("leave").articles[topic].branch));
    }
  });

  it("long article is truncated with link", async () => {
    const long = {
      법령: {
        기본정보: { 법령명_한글: "테스트", 공포일자: "20260407" },
        조문: {
          조문단위: {
            조문번호: "74",
            조문제목: "(테스트) 조문 제목",
            항: Array.from({ length: 300 }, (_, i) => ({ 항내용: `${i}`.padEnd(40, "가") })),
          },
        },
      },
    };
    const name = lawNameOf("maternity_leave");
    const mock = createLawMock(...standardRoutes(name, long));
    const ctx = ctxOf(mock.fetch);
    const r = await call("maternity_leave", ctx);
    expect(r.isError).toBeFalsy();
    const t = text(r);
    expect(t.length).toBeLessThanOrEqual(ctx.config.maxResponseChars);
    expect(t).toContain("조문 일부 생략");
    expect(t).toContain(basisUrlOf("maternity_leave"));
  });

  it("stored law_id skips search; missing article is guidance, not error", async () => {
    const notFound = createLawMock((url) =>
      url.searchParams.get("target") === "law" ? jsonRes({ LawSearch: { totalCnt: "0" } }) : undefined,
    );
    const r1 = await call("maternity_leave", ctxOf(notFound.fetch));
    expect(r1.isError).toBeFalsy();
    expect(text(r1)).toContain("찾지 못했습니다");
    expect(text(r1)).toContain("법령명");
    expect(text(r1)).toContain("https://www.law.go.kr");
    expect(notFound.urls.some((u) => new URL(u).searchParams.get("target") === "law")).toBe(false);

    const missing = createLawMock(...standardRoutes(lawNameOf("maternity_leave"), { 법령: { 기본정보: {} } }));
    const r2 = await call("maternity_leave", ctxOf(missing.fetch));
    expect(r2.isError).toBeFalsy();
    expect(text(r2)).toContain("조문");
  });

  it("upstream failures are errors with distinct actions", async () => {
    const http500 = createLawMock(() => new Response("oops", { status: 500 }));
    const hang = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    const html = createLawMock(() => htmlRes());

    const results = [
      await call("maternity_leave", ctxOf(http500.fetch)),
      await call("maternity_leave", ctxOf(hang, { httpTimeoutMs: 50 })),
      await call("maternity_leave", ctxOf(html.fetch)),
    ];
    for (const r of results) expect(r.isError).toBe(true);
    expect(text(results[0]!)).toContain("HTTP 500");
    expect(text(results[1]!)).toContain("TIMEOUT");
    expect(text(results[2]!)).toContain("HTML");

    const actions = results.map((r) => text(r).slice(text(r).indexOf("조치:")));
    expect(new Set(actions).size).toBe(3);
  });

  it("invalid topic is BAD_INPUT", async () => {
    const r = await call("sick_leave", ctxOf(createLawMock().fetch));
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("BAD_INPUT");
    expect(text(r)).toContain("topic");
  });

  it("OC never appears in output, errors or logs", async () => {
    const logs: string[] = [];
    const sink = (line: string) => logs.push(line);
    const ok = createLawMock(...standardRoutes(lawNameOf("maternity_leave")));
    const html = createLawMock(() => htmlRes());
    const denied = createLawMock(
      () => new Response("사용자 정보 검증에 실패했습니다", { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } }),
    );

    const outputs: string[] = [];
    for (const f of [ok.fetch, html.fetch, denied.fetch]) {
      const r = await call("maternity_leave", ctxOf(f, { sink }));
      outputs.push(text(r));
    }
    for (const t of [...outputs, ...logs]) {
      expect(t).not.toContain(FAKE);
      expect(t).not.toContain(ENCODED_FAKE);
    }
    expect(outputs[2]).toContain("IP");
    expect(outputs[2]).toContain("도메인");
  });
});
