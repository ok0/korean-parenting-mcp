import type { ToolContext } from "./context.js";
import { ToolError } from "./errors.js";

export interface HttpResponse {
  status: number;
  contentType: string;
  text: string;
}

export interface HttpOptions {
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  headers?: Record<string, string>;
  allowErrorStatus?: boolean;
}

const RETRYABLE_STATUS: ReadonlySet<number> = new Set([429, 503, 504]);

async function attemptOnce(
  url: URL,
  ctx: Pick<ToolContext, "fetch">,
  timeoutMs: number,
  headers?: Record<string, string>,
): Promise<HttpResponse> {
  const ac = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ac.abort();
      reject(new ToolError("TIMEOUT", `외부 서버 응답 시간 초과(${timeoutMs}ms)`));
    }, timeoutMs);
  });
  const request = (async (): Promise<HttpResponse> => {
    const res =
      headers === undefined
        ? await ctx.fetch(url.href, { signal: ac.signal })
        : await ctx.fetch(url.href, { signal: ac.signal, headers: { ...headers } });
    const text = await res.text();
    return { status: res.status, contentType: res.headers.get("content-type") ?? "", text };
  })();
  try {
    return await Promise.race([request, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function httpGet(
  url: URL,
  ctx: Pick<ToolContext, "fetch" | "log" | "config">,
  opts: HttpOptions = {},
): Promise<HttpResponse> {
  const timeoutMs = opts.timeoutMs ?? ctx.config.httpTimeoutMs;
  const retries = opts.retries ?? 1;
  const retryDelayMs = opts.retryDelayMs ?? 500;
  const host = url.host;
  const path = url.pathname;
  const started = Date.now();
  let attempts = 0;

  for (;;) {
    attempts += 1;
    const canRetry = attempts <= retries;
    let res: HttpResponse;
    try {
      res = await attemptOnce(url, ctx, timeoutMs, opts.headers);
    } catch (err) {
      if (err instanceof ToolError && err.kind === "TIMEOUT") {
        ctx.log.info("http fail", { host, path, kind: "TIMEOUT" });
        throw err;
      }
      if (canRetry) {
        await delay(retryDelayMs);
        continue;
      }
      ctx.log.info("http fail", { host, path, kind: "UPSTREAM" });
      throw new ToolError("UPSTREAM", "외부 서버에 연결하지 못했습니다");
    }

    if (res.status >= 200 && res.status < 300) {
      ctx.log.debug("http", { host, path, status: res.status, attempts, ms: Date.now() - started });
      return res;
    }

    if (RETRYABLE_STATUS.has(res.status) && canRetry) {
      await delay(retryDelayMs);
      continue;
    }

    if (opts.allowErrorStatus) {
      ctx.log.info("http status", { host, path, status: res.status });
      return res;
    }

    if (res.status === 429) {
      ctx.log.info("http fail", { host, path, kind: "RATE_LIMIT" });
      throw new ToolError("RATE_LIMIT", "외부 서버 호출 한도 초과(HTTP 429)");
    }
    ctx.log.info("http fail", { host, path, kind: "UPSTREAM" });
    throw new ToolError("UPSTREAM", `외부 서버 오류(HTTP ${res.status})`);
  }
}
