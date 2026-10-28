import { readFileSync } from "node:fs";
import type { Config } from "../../src/core/config.js";
import type { ToolContext } from "../../src/core/context.js";
import { createTestContext } from "./context.js";

export { hangUntilAbort } from "./kasi-mock.js";

export const KG_TEST_KEY = "Kg+id/=7 Q&z9-m16";
export const KG_KEY_FORMS: readonly string[] = [KG_TEST_KEY, encodeURIComponent(KG_TEST_KEY), new URLSearchParams({ x: KG_TEST_KEY }).toString().slice(2)];
export const KG_PATH = "/api/notice/basicInfo2.do";

export const kgFx = (name: string): string => readFileSync(new URL(`../fixtures/kindergarten/${name}`, import.meta.url), "utf8");

export function kgRes(text: string, status = 200, contentType = "text/html;charset=UTF-8"): Response {
  return new Response(text, { status, headers: { "content-type": contentType } });
}

export function kgBody(items: readonly Record<string, unknown>[], status = "SUCCESS"): string {
  return JSON.stringify({ status, kinderInfo: items });
}

export function kgItems(name = "basicInfo2.json"): Record<string, unknown>[] {
  const parsed = JSON.parse(kgFx(name)) as { kinderInfo: Record<string, unknown>[] };
  return parsed.kinderInfo;
}

export function kgMany(n: number): Record<string, unknown>[] {
  const base = kgItems();
  return Array.from({ length: n }, (_, i) => ({
    ...base[i % 5],
    key: String(i + 1),
    kindercode: `synthetic-${String(i + 1).padStart(4, "0")}`,
    kindername: `합성유치원${String(i + 1).padStart(3, "0")}`,
  }));
}

export type KgRoute = (url: URL, init?: RequestInit) => Response | Promise<Response>;

export interface KgMock { fetch: typeof fetch; calls: URL[]; count(): number }

export function createKgMock(route?: KgRoute): KgMock {
  const calls: URL[] = [];
  const fakeFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname !== "e-childschoolinfo.moe.go.kr" || url.pathname !== KG_PATH) throw new Error("unexpected url");
    calls.push(url);
    return (route ?? (() => kgRes(kgFx("basicInfo2.json"))))(url, init);
  };
  return {
    fetch: fakeFetch as typeof fetch,
    calls,
    count: () => calls.length,
  };
}

export function kgCtx(
  mock: KgMock,
  opts?: { env?: Record<string, string>; sink?: (line: string) => void; config?: Partial<Config>; now?: () => Date },
): ToolContext {
  const base = createTestContext({ env: { KINDERGARTEN_API_KEY: KG_TEST_KEY, ...opts?.env }, sink: opts?.sink });
  return {
    ...base,
    fetch: mock.fetch,
    clock: { now: opts?.now ?? (() => new Date("2026-10-28T21:30:00+09:00")) },
    config: { ...base.config, ...opts?.config },
  };
}
