import { BlockList, isIP } from "node:net";
import type { IncomingHttpHeaders } from "node:http";

export const WINDOW_MS = 60_000;
export const DEFAULT_MAX_CLIENTS = 10_000;
const SWEEP_INTERVAL_MS = 30_000;

export type TakeResult =
  | { ok: true; pool: "direct" | "shared"; release(): void }
  | { ok: false; pool: "direct" | "shared"; retryAfterSec: number; scope: "client" | "shared" | "global" | "concurrency" };

export interface RateLimiter {
  take(clientKey: string, nowMs: number): Promise<TakeResult>;
  readonly trackedClients: number;
}

export interface RateLimitOptions {
  perClientPerMin: number;
  sharedPoolPerMin: number;
  globalPerMin: number;
  maxConcurrent: number;
  sharedEgressCidrs: readonly string[];
  maxClients?: number;
  sweepIntervalMs?: number;
}

export interface ClientKeyOptions {
  trustProxy: "none" | "xff";
  trustedProxyCidrs: readonly string[];
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
  const timer = setInterval(() => sweep(Date.now()), opts.sweepIntervalMs ?? SWEEP_INTERVAL_MS);
  timer.unref();

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
      if (active >= opts.maxConcurrent) {
        return { ok: false, pool, scope: "concurrency", retryAfterSec: 1 };
      }

      counter.count++;
      global.count++;
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
    const last = raw.split(",").pop() ?? "";
    return normalizeIp(last) ?? sock;
  };
}
