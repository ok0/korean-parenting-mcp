import { readFileSync } from "node:fs";
import { SK_SPECS, type SkService } from "../../src/clients/safetykorea.js";
import type { Config } from "../../src/core/config.js";
import type { ToolContext } from "../../src/core/context.js";
import { createTestContext } from "./context.js";

export { hangUntilAbort } from "./kasi-mock.js";

export const SK_TEST_KEY = "Sk+id/=7 Q&z9-m14";
export const SK_KEY_FORMS: readonly string[] = [SK_TEST_KEY, encodeURIComponent(SK_TEST_KEY), new URLSearchParams({ x: SK_TEST_KEY }).toString().slice(2)];

export const skFx = (name: string): string => readFileSync(new URL(`../fixtures/safetykorea/${name}`, import.meta.url), "utf8");

export function skJson(text: string, status = 200): Response {
  return new Response(text, { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

export function skHtml(status = 200): Response {
  return new Response("<!doctype html><html><body>error</body></html>", { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

export function skBody(code: string, rows: readonly Record<string, unknown>[] = []): string {
  return JSON.stringify({ resultCode: code, resultMsg: code === "2000" ? "Success" : "x", resultData: rows });
}

export function skRows(service: SkService): Record<string, unknown>[] {
  const parsed = JSON.parse(skFx(`${service}.json`)) as { resultData: Record<string, unknown>[] };
  return parsed.resultData;
}

export type SkRoute = (url: URL, init?: RequestInit) => Response | Promise<Response>;

export interface SkCall { url: URL; service: SkService; headers: Record<string, string> | undefined }

export interface SkMock { fetch: typeof fetch; calls: SkCall[]; count(service: SkService): number }

export function createSkMock(routes: Partial<Record<SkService, SkRoute>> = {}): SkMock {
  const calls: SkCall[] = [];
  const fakeFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const service = (Object.keys(SK_SPECS) as SkService[]).find((s) => url.pathname.endsWith("/" + SK_SPECS[s].path));
    if (service === undefined) throw new Error("unexpected url");
    calls.push({ url, service, headers: init?.headers as Record<string, string> | undefined });
    const route: SkRoute = routes[service] ?? (() => skJson(skFx(`${service}.json`)));
    return route(url, init);
  };
  return {
    fetch: fakeFetch as typeof fetch,
    calls,
    count: (service) => calls.filter((c) => c.service === service).length,
  };
}

export function skCtx(
  mock: SkMock,
  opts?: { env?: Record<string, string>; sink?: (line: string) => void; config?: Partial<Config>; now?: () => Date },
): ToolContext {
  const base = createTestContext({ env: { SAFETYKOREA_AUTH_KEY: SK_TEST_KEY, ...opts?.env }, sink: opts?.sink });
  return {
    ...base,
    fetch: mock.fetch,
    clock: { now: opts?.now ?? (() => new Date("2026-10-28T21:30:00+09:00")) },
    config: { ...base.config, ...opts?.config },
  };
}
