import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/core/config.js";
import { DEFAULT_BUDGETS, DEFAULT_MIN_TTL_MS, UPSTREAM_BUCKETS } from "../../src/core/upstream-guard.js";
import { REMOTE_POLICY } from "../../src/remote/allowlist.js";
import { loadRemoteConfig, RemoteConfigError, restrictKeys } from "../../src/remote/remote-config.js";
import { REMOTE_TEST_ENV, REQUIRED_REMOTE_ENV } from "../helpers/remote-env.js";

describe("loadRemoteConfig", () => {
  it("defaults", () => {
    const rc = loadRemoteConfig(REMOTE_TEST_ENV);
    expect(rc.port).toBe(8080);
    expect(rc.host).toBe("127.0.0.1");
    expect(rc.allowedHosts).toEqual(["localhost", "127.0.0.1"]);
    expect(rc.allowedOrigins).toEqual(["https://claude.ai", "https://claude.com", "https://localhost"]);
    expect(rc.bearerToken).toBeUndefined();
    expect(rc.trustProxy).toBe("none");
    expect(rc.originPolicy).toBe("strict");
    expect(rc.getMode).toBe("sse");
    expect(rc.sseMaxMs).toBe(60000);
    expect(rc.xffClientIndexFromRight).toBe(1);
    expect(rc.dailyRequestCap).toBe(10000);
    expect(rc.lawRemote).toBe(false);
    expect(rc.sseMaxStreams).toBe(32);
    expect(rc.maxBodyBytes).toBe(65536);
    expect(rc.rate).toEqual({ perClientPerMin: 30, sharedPoolPerMin: 600, globalPerMin: 900, maxConcurrent: 16 });
    expect(rc.sharedEgressCidrs).toEqual(["160.79.104.0/21"]);
    expect(rc.trustedProxyCidrs).toContain("127.0.0.0/8");
  });

  it("parses lists", () => {
    const rc = loadRemoteConfig({ ...REMOTE_TEST_ENV,
      KPM_ALLOWED_HOSTS: " Example.COM ,localhost",
      KPM_ALLOWED_ORIGINS: "https://a.example/",
    });
    expect(rc.allowedHosts).toEqual(["example.com", "localhost"]);
    expect(rc.allowedOrigins).toEqual(["https://a.example", "https://example.com"]);
  });

  it.each([
    ["KPM_HTTP_PORT", "abc"],
    ["KPM_HTTP_PORT", "70000"],
    ["KPM_ALLOWED_HOSTS", " , "],
    ["KPM_ALLOWED_ORIGINS", "ftp://x.example"],
    ["KPM_ALLOWED_ORIGINS", "https://x.example/path"],
    ["KPM_TRUST_PROXY", "maybe"],
    ["KPM_ORIGIN_POLICY", "loose"],
    ["KPM_GET_MODE", "post"],
    ["KPM_REMOTE_BEARER_TOKEN", "short-token-value-123"],
    ["KPM_MAX_BODY_BYTES", "abc"],
    ["KPM_MAX_BODY_BYTES", "10"],
    ["KPM_RATE_PER_CLIENT_PER_MIN", "abc"],
    ["KPM_RATE_SHARED_POOL_PER_MIN", "-5"],
    ["KPM_RATE_GLOBAL_PER_MIN", "0"],
    ["KPM_RATE_MAX_CONCURRENT", "1.5"],
    ["KPM_TRUSTED_PROXY_CIDRS", "10.0.0.0/33"],
    ["KPM_SHARED_EGRESS_CIDRS", "not-a-cidr"],
    ["KPM_XFF_CLIENT_INDEX", "0"],
    ["KPM_XFF_CLIENT_INDEX", "abc"],
    ["KPM_XFF_CLIENT_INDEX", "1.5"],
    ["KPM_XFF_CLIENT_INDEX", "33"],
    ["KPM_DAILY_REQUEST_CAP", "0"],
    ["KPM_DAILY_REQUEST_CAP", "-1"],
    ["KPM_DAILY_REQUEST_CAP", "abc"],
    ["KPM_DAILY_REQUEST_CAP", "1.5"],
    ["KPM_SSE_MAX_MS", "999"],
    ["KPM_SSE_MAX_MS", "300001"],
    ["KPM_SSE_MAX_MS", "abc"],
    ["KPM_LAW_REMOTE", "yes"],
    ["KPM_HOST_REQUEST_LOGS", "kept"],
    ["PORT", "abc"],
    ["PORT", "70000"],
  ])("invalid %s fails with item name only", (name, value) => {
    let caught: unknown;
    try {
      loadRemoteConfig({ ...REMOTE_TEST_ENV, [name]: value });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RemoteConfigError);
    const err = caught as RemoteConfigError;
    expect(err.item).toBe(name);
    expect(err.message).toContain(name);
    expect(err.message).not.toContain(value);
  });

  it("bearer token accepted and masked", () => {
    const token = "a".repeat(40);
    const rc = loadRemoteConfig({ ...REMOTE_TEST_ENV, KPM_REMOTE_BEARER_TOKEN: token });
    expect(rc.bearerToken).toBe(token);
    expect(rc.secrets).toContain(token);
  });

  it("keys use local env names", () => {
    const rc = loadRemoteConfig({ ...REMOTE_TEST_ENV, LAW_OC: "fake-law-oc-value" });
    expect(rc.base.keys.LAW_OC).toBeUndefined();
    expect(rc.secrets).toContain("fake-law-oc-value");
  });

  it("port precedence", () => {
    expect(loadRemoteConfig(REMOTE_TEST_ENV).port).toBe(8080);
    expect(loadRemoteConfig({ ...REMOTE_TEST_ENV, PORT: "9090" }).port).toBe(9090);
    expect(loadRemoteConfig({ ...REMOTE_TEST_ENV, KPM_HTTP_PORT: "7000", PORT: "9090" }).port).toBe(7000);
    expect(loadRemoteConfig({ ...REMOTE_TEST_ENV, KPM_HTTP_PORT: "7000", PORT: "abc" }).port).toBe(7000);
    let caught: unknown;
    try {
      loadRemoteConfig({ ...REMOTE_TEST_ENV, KPM_HTTP_PORT: "abc", PORT: "9090" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RemoteConfigError);
    expect((caught as RemoteConfigError).item).toBe("KPM_HTTP_PORT");
  });

  it("KPM_LAW_REMOTE=on enables law revision checks", () => {
    expect(loadRemoteConfig({ ...REMOTE_TEST_ENV, KPM_LAW_REMOTE: "on" }).lawRemote).toBe(true);
  });

  it("overrides for xff index, daily cap and sse max", () => {
    const rc = loadRemoteConfig({ ...REMOTE_TEST_ENV,
      KPM_XFF_CLIENT_INDEX: "2",
      KPM_DAILY_REQUEST_CAP: "5",
      KPM_SSE_MAX_MS: "1000",
    });
    expect(rc.xffClientIndexFromRight).toBe(2);
    expect(rc.dailyRequestCap).toBe(5);
    expect(rc.sseMaxMs).toBe(1000);
  });

  it("parses rate and cidr env", () => {
    const rc = loadRemoteConfig({ ...REMOTE_TEST_ENV,
      KPM_RATE_PER_CLIENT_PER_MIN: "5",
      KPM_SHARED_EGRESS_CIDRS: "10.1.0.0/16, ::ffff:0:0/96",
    });
    expect(rc.rate.perClientPerMin).toBe(5);
    expect(rc.sharedEgressCidrs).toEqual(["10.1.0.0/16", "::ffff:0:0/96"]);
  });

  it("removes keys used only by excluded tools", () => {
    const rc = loadRemoteConfig({ ...REMOTE_TEST_ENV, SAFETYKOREA_AUTH_KEY: "Sk-fake-value-1234", LAW_OC: "fake-law-oc-value" });
    expect(rc.base.keys.SAFETYKOREA).toBeUndefined();
    expect(rc.base.keys.LAW_OC).toBeUndefined();
    expect(rc.secrets).toContain("Sk-fake-value-1234");
  });

  it("LAW_OC is removed from base keys and kept in secrets", () => {
    const rc = loadRemoteConfig({ ...REMOTE_TEST_ENV, LAW_OC: "fake-law-oc-value" });
    expect(rc.base.keys.LAW_OC).toBeUndefined();
    expect(rc.secrets).toContain("fake-law-oc-value");
  });

  it("restrictKeys keeps keys when a tool is exposed", () => {
    const config = restrictKeys(
      { ...loadConfig({ SAFETYKOREA_AUTH_KEY: "x".repeat(10) }) },
      REMOTE_POLICY.map((p) => ({ ...p, expose: true })),
    );
    expect(config.keys.SAFETYKOREA).toBe("x".repeat(10));
  });
});

describe("loadRemoteConfig quota", () => {
  it("quota defaults", () => {
    const rc = loadRemoteConfig(REMOTE_TEST_ENV);
    expect(rc.quota).toEqual({
      budgets: { ...DEFAULT_BUDGETS },
      minTtlMs: { ...DEFAULT_MIN_TTL_MS },
      defaultMinTtlMs: 3_600_000,
      staleMaxMs: 86_400_000,
      alertRatio: 0.8,
    });
    expect(rc.quota.alertWebhookUrl).toBeUndefined();
    expect(rc.quota.budgets.law).toBe(0);
    for (const b of UPSTREAM_BUCKETS) expect(rc.quota.minTtlMs[b]).toBeGreaterThan(0);
  });

  it("quota overrides and webhook secret", () => {
    const url = "https://hook.example/abc";
    const rc = loadRemoteConfig({ ...REMOTE_TEST_ENV,
      KPM_BUDGET_NEMC_LIST: "900",
      KPM_BUDGET_SAFETYKOREA: "0",
      KPM_MIN_TTL_NEMC_MOONLIGHT_MS: "600000",
      KPM_ALERT_RATIO: "0.5",
      KPM_ALERT_WEBHOOK_URL: url,
    });
    expect(rc.quota.budgets.nemcList).toBe(900);
    expect(rc.quota.budgets.safetykorea).toBe(0);
    expect(rc.quota.minTtlMs.nemcMoonlight).toBe(600_000);
    expect(rc.quota.alertRatio).toBe(0.5);
    expect(rc.quota.alertWebhookUrl).toBe(url);
    expect(rc.secrets).toContain(url);
  });

  it.each([
    ["KPM_BUDGET_DUR", "-1"],
    ["KPM_BUDGET_DUR", "1.5"],
    ["KPM_BUDGET_LAW", "abc"],
    ["KPM_MIN_TTL_NEMC_LIST_MS", "0"],
    ["KPM_MIN_TTL_DEFAULT_MS", "x"],
    ["KPM_ALERT_RATIO", "0"],
    ["KPM_ALERT_RATIO", "1.5"],
    ["KPM_ALERT_RATIO", "abc"],
    ["KPM_ALERT_WEBHOOK_URL", "http://hook.example"],
    ["KPM_ALERT_WEBHOOK_URL", "not a url"],
  ])("invalid %s=%s fails with item name only", (name, value) => {
    let caught: unknown;
    try {
      loadRemoteConfig({ ...REMOTE_TEST_ENV, [name]: value });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RemoteConfigError);
    const err = caught as RemoteConfigError;
    expect(err.item).toBe(name);
    expect(err.message).toContain(name);
    expect(err.message).not.toContain(value);
  });
});

describe("loadRemoteConfig hosting disclosure", () => {
  it("reads hosting disclosure and contact", () => {
    const rc = loadRemoteConfig(REMOTE_TEST_ENV);
    expect(rc.hosting).toEqual({
      provider: "host-provider-sentinel",
      country: "KR",
      region: "host-region-sentinel",
      logRetention: "log-retention-sentinel-30d",
      requestLogs: "excluded",
    });
    expect(rc.operatorContact).toBe("operator-contact-sentinel@example.com");
    expect(rc.secrets).not.toContain("operator-contact-sentinel@example.com");
  });

  it.each(REQUIRED_REMOTE_ENV)("missing or blank %s fails with item name only", (name) => {
    for (const env of [
      Object.fromEntries(Object.entries(REMOTE_TEST_ENV).filter(([k]) => k !== name)),
      { ...REMOTE_TEST_ENV, [name]: "   " },
    ]) {
      let caught: unknown;
      try {
        loadRemoteConfig(env);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(RemoteConfigError);
      expect((caught as RemoteConfigError).item).toBe(name);
    }
  });

  it.each(REQUIRED_REMOTE_ENV)("too long or control char %s fails", (name) => {
    for (const value of [`SENTINELVAL${"x".repeat(200)}`, "ab\u0007cd"]) {
      let caught: unknown;
      try {
        loadRemoteConfig({ ...REMOTE_TEST_ENV, [name]: value });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(RemoteConfigError);
      const err = caught as RemoteConfigError;
      expect(err.item).toBe(name);
      expect(err.message).not.toContain("SENTINELVAL");
    }
    const ok = name === "KPM_HOST_REQUEST_LOGS" ? "retained" : "y".repeat(200);
    expect(() => loadRemoteConfig({ ...REMOTE_TEST_ENV, [name]: ok })).not.toThrow();
  });
});
