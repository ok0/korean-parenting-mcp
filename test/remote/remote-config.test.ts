import { describe, expect, it } from "vitest";
import { loadRemoteConfig, RemoteConfigError } from "../../src/remote/remote-config.js";

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
});
