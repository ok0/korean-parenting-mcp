import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import {
  createMetricsLog,
  createRemoteLogger,
  installCrashHandlers,
  QUOTA_KEYS,
  REQ_KEYS,
  type MetricsEvent,
} from "../../src/remote/metrics-log.js";

describe("metrics log", () => {
  it("req event copies only whitelisted keys", () => {
    const lines: string[] = [];
    const ev = {
      ev: "req",
      rpc: "tools/call",
      tool: "get_timeline",
      http: 200,
      outcome: "ok",
      ms: 12.4,
      origin: "claude",
      proto: "2025-11-25",
      pool: "shared",
      ip: "203.0.113.77",
      args: { q: "센티넬" },
      ua: "SentinelUA",
    } as unknown as MetricsEvent;
    createMetricsLog((l) => lines.push(l)).emit(ev);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] as string) as Record<string, unknown>;
    for (const k of Object.keys(parsed)) expect(REQ_KEYS).toContain(k);
    expect(parsed.ms).toBe(12);
    expect(lines[0]).not.toContain("203.0.113.77");
    expect(lines[0]).not.toContain("센티넬");
    expect(lines[0]).not.toContain("SentinelUA");
  });

  it("unregistered tool becomes unknown", () => {
    const lines: string[] = [];
    createMetricsLog((l) => lines.push(l)).emit({
      ev: "req",
      rpc: "tools/call",
      tool: "fx_sentinel_tool",
      http: 200,
      outcome: "ok",
      ms: 1,
      origin: "none",
    });
    expect(JSON.parse(lines[0] as string).tool).toBe("unknown");
  });

  it("invalid enum and proto values are dropped", () => {
    const lines: string[] = [];
    createMetricsLog((l) => lines.push(l)).emit({
      ev: "req",
      rpc: "tools/list",
      http: 200,
      outcome: "ok",
      ms: 1,
      origin: "none",
      proto: "<script>",
      metaProto: "x",
      reason: "evil",
      kind: "NOPE",
      pool: "x",
    } as unknown as MetricsEvent);
    const parsed = JSON.parse(lines[0] as string) as Record<string, unknown>;
    expect("proto" in parsed).toBe(false);
    expect("metaProto" in parsed).toBe(false);
    expect("reason" in parsed).toBe(false);
    expect("kind" in parsed).toBe(false);
    expect("pool" in parsed).toBe(false);
  });

  it("start and crash lines", () => {
    const lines: string[] = [];
    const m = createMetricsLog((l) => lines.push(l));
    m.emit({ ev: "start", version: "0.1.0" });
    expect(lines[0]).toBe('{"ev":"start","version":"0.1.0"}\n');
    m.emit({ ev: "crash", kind: "Type Error!" });
    expect(lines[1]).toBe('{"ev":"crash","kind":"unknown"}\n');
    m.emit({ ev: "other" } as unknown as MetricsEvent);
    expect(lines).toHaveLength(2);
  });

  it("remote logger filters meta", () => {
    const lines: string[] = [];
    const sink = (l: string) => lines.push(l);
    const logger = createRemoteLogger(["Sk+id/=7 Q&z9-m14"], sink);
    logger.warn("tool error", {
      tool: "fx_sentinel_tool",
      kind: "UPSTREAM",
      region: "센티넬구",
      path: "/a/b",
      host: "apis.data.go.kr",
    });
    expect(lines[0]).toContain('"tool":"unknown"');
    expect(lines[0]).toContain('"kind":"UPSTREAM"');
    expect(lines[0]).toContain('"host":"apis.data.go.kr"');
    expect(lines[0]).not.toContain("region");
    expect(lines[0]).not.toContain("path");
    expect(lines[0]).not.toContain("센티넬구");

    logger.debug("hidden", {});
    expect(lines).toHaveLength(1);

    logger.info("x 센티넬", {});
    expect(lines[1]).toContain(" INFO log");
    expect(lines[1]).not.toContain("센티넬");

    logger.info("fmt", { code: "Sk+id/=7 Q&z9-m14" });
    expect(lines[2]).not.toContain("Sk+id/=7");
    expect(lines[2]).not.toContain("code");

    const masked: string[] = [];
    createRemoteLogger(["abcd1234"], (l) => masked.push(l)).info("fmt", { code: "abcd1234" });
    expect(masked[0]).toContain("***");
    expect(masked[0]).not.toContain("abcd1234");
  });

  it("crash handlers emit name only and exit 1", () => {
    const ee = new EventEmitter();
    const lines: string[] = [];
    const codes: number[] = [];
    installCrashHandlers(ee, createMetricsLog((l) => lines.push(l)), (c) => codes.push(c));
    ee.emit("uncaughtException", new TypeError("sentinel-msg"));
    expect(lines).toEqual(['{"ev":"crash","kind":"TypeError"}\n']);
    expect(codes).toEqual([1]);
    ee.emit("unhandledRejection", "str");
    expect(lines).toHaveLength(1);
    expect(codes).toEqual([1, 1]);
  });

  it("quota event whitelisted", () => {
    const lines: string[] = [];
    createMetricsLog((l) => lines.push(l)).emit({
      ev: "quota",
      bucket: "dur",
      day: "2026-10-28",
      count: 8,
      limit: 10,
      level: "near",
      url: "https://x",
      args: "센티넬",
    } as unknown as MetricsEvent);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] as string) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual([...QUOTA_KEYS]);
    expect(lines[0]).not.toContain("센티넬");
    expect(lines[0]).not.toContain("https");
  });

  it("invalid quota dropped", () => {
    const lines: string[] = [];
    const m = createMetricsLog((l) => lines.push(l));
    const base = { ev: "quota", bucket: "dur", day: "2026-10-28", count: 8, limit: 10, level: "near" };
    m.emit({ ...base, bucket: "unknownBucket" } as unknown as MetricsEvent);
    m.emit({ ...base, day: "28-10-2026" } as unknown as MetricsEvent);
    m.emit({ ...base, count: -1 } as unknown as MetricsEvent);
    m.emit({ ...base, level: "warn" } as unknown as MetricsEvent);
    expect(lines).toEqual([]);
  });
});
