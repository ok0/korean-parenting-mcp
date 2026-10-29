import type { QuotaEvent } from "../core/upstream-guard.js";
import { quotaJson } from "./metrics-log.js";

export const WEBHOOK_TIMEOUT_MS = 3000;

export function createWebhookNotifier(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs = WEBHOOK_TIMEOUT_MS,
): (e: QuotaEvent) => Promise<void> {
  return (e) => {
    const body = quotaJson(e);
    if (body === undefined) return Promise.resolve();
    const ac = new AbortController();
    let t: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      t = setTimeout(() => {
        ac.abort();
        resolve();
      }, timeoutMs);
      t.unref?.();
    });
    const send = (async () => {
      try {
        const res = await fetchImpl(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
          signal: ac.signal,
        });
        void res.body?.cancel().catch(() => {});
      } catch {}
    })();
    return Promise.race([send, timeout]).finally(() => clearTimeout(t));
  };
}
