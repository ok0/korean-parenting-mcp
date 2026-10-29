import { BlockList, isIP } from "node:net";
import type { IncomingHttpHeaders } from "node:http";

export const WINDOW_MS = 60_000;
export const DEFAULT_MAX_CLIENTS = 10_000;
const SWEEP_INTERVAL_MS = 30_000;
const DAY_MS = 86_400_000;
const KST_OFFSET_MS = 9 * 3_600_000;
const kstDayIndex = (ms: number): number => Math.floor((ms + KST_OFFSET_MS) / DAY_MS);

export type TakeResult =
  | { ok: true; pool: "direct" | "shared"; release(): void }
  | { ok: false; pool: "direct" | "shared"; retryAfterSec: number; scope: "client" | "shared" | "global" | "daily" | "concurrency" };

export interface RateLimiter {
  take(clientKey: string, nowMs: number): Promise<TakeResult>;
  clear(): void; // empties all windows (SIGTERM)
  readonly trackedClients: number;
}

export interface RateLimitOptions {
  perClientPerMin: number;
  sharedPoolPerMin: number;
  globalPerMin: number;
  maxConcurrent: number;
  sharedEgressCidrs: readonly string[];
  maxClients?: number;
  dailyCap?: number;
  sweepIntervalMs?: number; // 0 = no timer; helper only, correctness comes from take()
}

export interface ClientKeyOptions {
  trustProxy: "none" | "xff";
  trustedProxyCidrs: readonly string[];
  xffClientIndexFromRight?: number;
}

interface Window {
  windowStart: number;
  count: number;
}

export function normalizeIp(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  let v = raw.trim().toLowerCase();
  if (v.startsWith("::ffff:") && isIP(v.slice(7)) === 4) v = v.slice(7);
  return isIP(v) !== 0 ? v : undefined;
}

function toBlockList(cidrs: readonly string[]): BlockList {
  const bl = new BlockList();
  for (const c of cidrs) {
    const [addr = "", prefix = ""] = c.split("/");
    bl.addSubnet(addr, Number(prefix), isIP(addr) === 6 ? "ipv6" : "ipv4");
  }
  return bl;
}

function inList(bl: BlockList, ip: string): boolean {
  const v = isIP(ip);
  return v === 0 ? false : bl.check(ip, v === 6 ? "ipv6" : "ipv4");
}

export function createRateLimiter(opts: RateLimitOptions): RateLimiter {
  const clients = new Map<string, Window>();
  const shared: Window = { windowStart: -Infinity, count: 0 };
  const global: Window = { windowStart: -Infinity, count: 0 };
  let active = 0;
  const egress = toBlockList(opts.sharedEgressCidrs);
  const max = opts.maxClients ?? DEFAULT_MAX_CLIENTS;
  const retry = (c: Window, now: number): number => Math.max(1, Math.ceil((c.windowStart + WINDOW_MS - now) / 1000));
  const sweep = (now: number): void => {
    for (const [k, c] of clients) if (now - c.windowStart >= WINDOW_MS) clients.delete(k);
  };
  const daily = { day: Number.NaN, count: 0 };
  const interval = opts.sweepIntervalMs ?? SWEEP_INTERVAL_MS;
  if (interval > 0) {
    const timer = setInterval(() => sweep(Date.now()), interval);
    timer.unref();
  }

  return {
    async take(key: string, now: number): Promise<TakeResult> {
      sweep(now);
      if (now - shared.windowStart >= WINDOW_MS) {
        shared.windowStart = now;
        shared.count = 0;
      }
      if (now - global.windowStart >= WINDOW_MS) {
        global.windowStart = now;
        global.count = 0;
      }
      const day = kstDayIndex(now);
      if (day !== daily.day) {
        daily.day = day;
        daily.count = 0;
      }

      const ip = normalizeIp(key) ?? key;
      const isShared = inList(egress, ip);
      const pool = isShared ? "shared" : "direct";
      const counter: Window = isShared ? shared : clients.get(ip) ?? { windowStart: now, count: 0 };
      const limit = isShared ? opts.sharedPoolPerMin : opts.perClientPerMin;

      if (counter.count >= limit) {
        return { ok: false, pool, scope: isShared ? "shared" : "client", retryAfterSec: retry(counter, now) };
      }
      if (global.count >= opts.globalPerMin) {
        return { ok: false, pool, scope: "global", retryAfterSec: retry(global, now) };
      }
      if (opts.dailyCap !== undefined && daily.count >= opts.dailyCap) {
        const resetMs = (day + 1) * DAY_MS - KST_OFFSET_MS;
        return { ok: false, pool, scope: "daily", retryAfterSec: Math.max(1, Math.ceil((resetMs - now) / 1000)) };
      }
      if (active >= opts.maxConcurrent) {
        return { ok: false, pool, scope: "concurrency", retryAfterSec: 1 };
      }

      counter.count++;
      global.count++;
      daily.count++;
      active++;
      if (!isShared && !clients.has(ip)) clients.set(ip, counter);
      while (clients.size > max) {
        const oldest = clients.keys().next().value;
        if (oldest === undefined) break;
        clients.delete(oldest);
      }

      let released = false;
      return {
        ok: true,
        pool,
        release() {
          if (released) return;
          released = true;
          active--;
        },
      };
    },
    clear() {
      clients.clear();
      shared.windowStart = -Infinity;
      shared.count = 0;
      global.windowStart = -Infinity;
      global.count = 0;
    },
    get trackedClients() {
      return clients.size;
    },
  };
}

export function createClientKeyResolver(
  opts: ClientKeyOptions,
): (req: { socket: { remoteAddress?: string }; headers: IncomingHttpHeaders }) => string {
  const trusted = toBlockList(opts.trustedProxyCidrs);
  return (req) => {
    const sock = normalizeIp(req.socket.remoteAddress) ?? "unknown";
    if (opts.trustProxy !== "xff") return sock;
    if (!inList(trusted, sock)) return sock;
    const h = req.headers["x-forwarded-for"];
    const raw = Array.isArray(h) ? h.join(",") : h;
    if (raw === undefined) return sock;
    const parts = raw.split(",");
    const pick = parts[parts.length - (opts.xffClientIndexFromRight ?? 1)];
    if (pick === undefined) return sock;
    return normalizeIp(pick) ?? sock;
  };
}
