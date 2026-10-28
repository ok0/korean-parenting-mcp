import type { ToolContext } from "./context.js";

export const CACHE_MAX_ENTRIES = 500;

interface Entry {
  value: unknown;
  expiresAt: number;
}

export class TtlCache {
  private readonly map = new Map<string, Entry>();
  readonly inflight = new Map<string, Promise<unknown>>();

  constructor(private readonly maxEntries: number = CACHE_MAX_ENTRIES) {}

  get<T>(key: string, nowMs: number): T | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (nowMs >= entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value as T;
  }

  set(key: string, value: unknown, ttlMs: number, nowMs: number): void {
    if (ttlMs <= 0) return;
    this.map.delete(key);
    this.map.set(key, { value, expiresAt: nowMs + ttlMs });
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  get size(): number {
    return this.map.size;
  }

  keys(): string[] {
    return [...this.map.keys()];
  }
}

export async function cached<T>(
  ctx: Pick<ToolContext, "cache" | "clock">,
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<{ value: T; fromCache: boolean }> {
  if (ttlMs <= 0) {
    return { value: await fn(), fromCache: false };
  }
  const hit = ctx.cache.get<{ v: T }>(key, ctx.clock.now().getTime());
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
      ctx.cache.set(key, { v }, ttlMs, ctx.clock.now().getTime());
      return v;
    } finally {
      ctx.cache.inflight.delete(key);
    }
  })();
  ctx.cache.inflight.set(key, p);
  return { value: await p, fromCache: false };
}
