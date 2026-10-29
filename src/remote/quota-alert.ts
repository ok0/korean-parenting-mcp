import type { QuotaEvent } from "../core/upstream-guard.js";
import { quotaJson } from "./metrics-log.js";

export const WEBHOOK_TIMEOUT_MS = 3000;

export function createWebhookNotifier(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs = WEBHOOK_TIMEOUT_MS,
): (e: QuotaEvent) => void {
  return (e) => {
    const body = quotaJson(e);
    if (body === undefined) return;
    void (async () => {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), timeoutMs);
      t.unref();
      try {
        const res = await fetchImpl(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
          signal: ac.signal,
        });
        void res.body?.cancel().catch(() => {});
      } catch {
      } finally {
        clearTimeout(t);
      }
    })();
  };
}
