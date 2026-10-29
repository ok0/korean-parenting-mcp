import { AsyncLocalStorage } from "node:async_hooks";
import type { ToolContext } from "./context.js";
import { ToolError, type ErrorKind } from "./errors.js";
import { bucketOfCacheKey, remoteQuotaError, staleNotice, type UpstreamGuard } from "./upstream-guard.js";

export const CACHE_MAX_ENTRIES = 500;

export type MaybePromise<T> = T | Promise<T>;

export interface CacheStore {
  get<T>(key: string, nowMs: number): MaybePromise<T | undefined>;
  set(key: string, value: unknown, ttlMs: number, nowMs: number): MaybePromise<void>;
  peekStale<T>(key: string, nowMs: number, maxAgeMs: number): MaybePromise<{ value: T; ageMs: number } | undefined>;
  readonly inflight: Map<string, Promise<unknown>>;
  keys(): string[];
  readonly size: number;
}

interface Entry {
  value: unknown;
  expiresAt: number;
  storedAt: number;
}

export class TtlCache implements CacheStore {
  private readonly map = new Map<string, Entry>();
  readonly inflight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly maxEntries: number = CACHE_MAX_ENTRIES,
    readonly staleRetentionMs = 0,
  ) {}

  get<T>(key: string, nowMs: number): T | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (nowMs >= entry.expiresAt) {
      if (nowMs >= entry.expiresAt + this.staleRetentionMs) this.map.delete(key);
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value as T;
  }

  set(key: string, value: unknown, ttlMs: number, nowMs: number): void {
    if (ttlMs <= 0) return;
    this.map.delete(key);
    this.map.set(key, { value, expiresAt: nowMs + ttlMs, storedAt: nowMs });
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  peekStale<T>(key: string, nowMs: number, maxAgeMs: number): { value: T; ageMs: number } | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (nowMs >= entry.expiresAt + this.staleRetentionMs) {
      this.map.delete(key);
      return undefined;
    }
    const ageMs = nowMs - entry.storedAt;
    if (ageMs > maxAgeMs) return undefined;
    return { value: entry.value as T, ageMs };
  }

  get size(): number {
    return this.map.size;
  }

  keys(): string[] {
    return [...this.map.keys()];
  }
}

const staleScope = new AsyncLocalStorage<{ ageMs?: number }>();
const STALE_KINDS = new Set<ErrorKind>(["DAILY_LIMIT", "RATE_LIMIT", "UPSTREAM", "TIMEOUT"]);
type Outcome<T> = { v: T; staleAgeMs?: number };

export async function cached<T>(
  ctx: Pick<ToolContext, "cache" | "clock"> & Partial<Pick<ToolContext, "upstream" | "notices">>,
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<{ value: T; fromCache: boolean; stale?: { ageMs: number } }> {
  if (ctx.upstream === undefined) {
    if (ttlMs <= 0) {
      return { value: await fn(), fromCache: false };
    }
    const got = ctx.cache.get<{ v: T }>(key, ctx.clock.now().getTime());
    const hit = got instanceof Promise ? await got : got;
    if (hit) {
      return { value: hit.v, fromCache: true };
    }
    const shared = ctx.cache.inflight.get(key);
    if (shared) {
      return { value: (await shared) as T, fromCache: true };
    }
    const p = (async () => {
      try {
        const v = await fn();
        const s = ctx.cache.set(key, { v }, ttlMs, ctx.clock.now().getTime());
        if (s instanceof Promise) await s;
        return v;
      } finally {
        ctx.cache.inflight.delete(key);
      }
    })();
    ctx.cache.inflight.set(key, p);
    return { value: await p, fromCache: false };
  }
  return cachedGuarded(ctx, ctx.upstream, key, ttlMs, fn);
}

async function cachedGuarded<T>(
  ctx: Pick<ToolContext, "cache" | "clock"> & Partial<Pick<ToolContext, "notices">>,
  guard: UpstreamGuard,
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<{ value: T; fromCache: boolean; stale?: { ageMs: number } }> {
  const ttl = Math.max(ttlMs, guard.minTtl(key));
  const got = await ctx.cache.get<{ v: T }>(key, ctx.clock.now().getTime());
  if (got) {
    return { value: got.v, fromCache: true };
  }
  let p = ctx.cache.inflight.get(key) as Promise<Outcome<T>> | undefined;
  const shared = p !== undefined;
  if (!p) {
    p = (async (): Promise<Outcome<T>> => {
      try {
        const scope = {} as { ageMs?: number };
        const v = await staleScope.run(scope, fn);
        if (scope.ageMs === undefined) {
          await ctx.cache.set(key, { v }, ttl, ctx.clock.now().getTime());
          return { v };
        }
        return { v, staleAgeMs: scope.ageMs };
      } catch (err) {
        return await recover(ctx, guard, key, err);
      } finally {
        ctx.cache.inflight.delete(key);
      }
    })();
    ctx.cache.inflight.set(key, p);
  }
  const out = await p;
  if (out.staleAgeMs !== undefined) {
    noteStale(ctx, out.staleAgeMs);
    return { value: out.v, fromCache: true, stale: { ageMs: out.staleAgeMs } };
  }
  return { value: out.v, fromCache: shared };
}

async function recover<T>(
  ctx: Pick<ToolContext, "cache" | "clock">,
  guard: UpstreamGuard,
  key: string,
  err: unknown,
): Promise<Outcome<T>> {
  if (!(err instanceof ToolError) || !STALE_KINDS.has(err.kind)) throw err;
  const now = ctx.clock.now().getTime();
  if (err.kind === "DAILY_LIMIT" && err.detail?.source !== "guard") {
    const b = bucketOfCacheKey(key);
    if (b !== undefined) await guard.markExhausted(b, now);
  }
  const s = await ctx.cache.peekStale<{ v: T }>(key, now, guard.staleMaxMs);
  if (s) return { v: s.value.v, staleAgeMs: s.ageMs };
  throw remoteQuotaError(err);
}

function noteStale(ctx: Partial<Pick<ToolContext, "notices">>, ageMs: number): void {
  const parent = staleScope.getStore();
  if (parent) parent.ageMs = Math.max(parent.ageMs ?? 0, ageMs);
  if (ctx.notices) {
    const msg = staleNotice(ageMs);
    if (!ctx.notices.includes(msg)) ctx.notices.push(msg);
  }
}
