import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/core/config.js";
import { REMOTE_POLICY } from "../../src/remote/allowlist.js";
import { loadRemoteConfig, RemoteConfigError, restrictKeys } from "../../src/remote/remote-config.js";

describe("loadRemoteConfig", () => {
  it("defaults", () => {
    const rc = loadRemoteConfig({});
    expect(rc.port).toBe(8080);
    expect(rc.host).toBe("127.0.0.1");
    expect(rc.allowedHosts).toEqual(["localhost", "127.0.0.1"]);
    expect(rc.allowedOrigins).toEqual(["https://claude.ai", "https://claude.com", "https://localhost"]);
    expect(rc.bearerToken).toBeUndefined();
    expect(rc.trustProxy).toBe("none");
    expect(rc.originPolicy).toBe("strict");
    expect(rc.getMode).toBe("sse");
    expect(rc.sseMaxMs).toBe(300000);
    expect(rc.sseMaxStreams).toBe(32);
    expect(rc.maxBodyBytes).toBe(65536);
    expect(rc.rate).toEqual({ perClientPerMin: 30, sharedPoolPerMin: 600, globalPerMin: 900, maxConcurrent: 16 });
    expect(rc.sharedEgressCidrs).toEqual(["160.79.104.0/21"]);
    expect(rc.trustedProxyCidrs).toContain("127.0.0.0/8");
  });

  it("parses lists", () => {
    const rc = loadRemoteConfig({
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
  ])("invalid %s fails with item name only", (name, value) => {
    let caught: unknown;
    try {
      loadRemoteConfig({ [name]: value });
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
    const rc = loadRemoteConfig({ KPM_REMOTE_BEARER_TOKEN: token });
    expect(rc.bearerToken).toBe(token);
    expect(rc.secrets).toContain(token);
  });

  it("keys use local env names", () => {
    const rc = loadRemoteConfig({ LAW_OC: "fake-law-oc-value" });
    expect(rc.base.keys.LAW_OC).toBe("fake-law-oc-value");
    expect(rc.secrets).toContain("fake-law-oc-value");
  });

  it("parses rate and cidr env", () => {
    const rc = loadRemoteConfig({
      KPM_RATE_PER_CLIENT_PER_MIN: "5",
      KPM_SHARED_EGRESS_CIDRS: "10.1.0.0/16, ::ffff:0:0/96",
    });
    expect(rc.rate.perClientPerMin).toBe(5);
    expect(rc.sharedEgressCidrs).toEqual(["10.1.0.0/16", "::ffff:0:0/96"]);
  });

  it("removes keys used only by excluded tools", () => {
    const rc = loadRemoteConfig({ SAFETYKOREA_AUTH_KEY: "Sk-fake-value-1234", LAW_OC: "fake-law-oc-value" });
    expect(rc.base.keys.SAFETYKOREA).toBeUndefined();
    expect(rc.base.keys.LAW_OC).toBe("fake-law-oc-value");
    expect(rc.secrets).toContain("Sk-fake-value-1234");
  });

  it("restrictKeys keeps keys when a tool is exposed", () => {
    const config = restrictKeys(
      { ...loadConfig({ SAFETYKOREA_AUTH_KEY: "x".repeat(10) }) },
      REMOTE_POLICY.map((p) => ({ ...p, expose: true })),
    );
    expect(config.keys.SAFETYKOREA).toBe("x".repeat(10));
  });
});
