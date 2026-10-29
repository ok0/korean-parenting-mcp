import { describe, expect, it } from "vitest";
import { checkRequest, normalizeHost, type GuardConfig } from "../../src/remote/request-guard.js";
import { loadRemoteConfig } from "../../src/remote/remote-config.js";

const TOKEN = "t".repeat(40);
const rc: GuardConfig = { ...loadRemoteConfig({}) };
const JSON_TYPE = { "content-type": "application/json" };

function req(method: string, url: string, extra: Record<string, string | undefined> = {}) {
  return { method, url, headers: { host: "127.0.0.1:8080", ...extra } };
}

describe("normalizeHost", () => {
  it("lowercases, trims and strips the port", () => {
    expect(normalizeHost(undefined)).toBeUndefined();
    expect(normalizeHost(" LOCALHOST:9999 ")).toBe("localhost");
    expect(normalizeHost("[::1]:8080")).toBe("[::1]");
  });
});

describe("checkRequest", () => {
  it("accepts POST /mcp with application/json", () => {
    expect(checkRequest(req("POST", "/mcp", JSON_TYPE), rc)).toEqual({ ok: true, route: "mcp" });
  });

  it("rejects POST /mcp with text/plain as 415", () => {
    expect(checkRequest(req("POST", "/mcp", { "content-type": "text/plain" }), rc))
      .toEqual({ ok: false, status: 415, reason: "type" });
  });

  it("accepts application/json with a charset parameter", () => {
    expect(checkRequest(req("POST", "/mcp", { "content-type": "application/json; charset=utf-8" }), rc))
      .toEqual({ ok: true, route: "mcp" });
  });

  it("accepts GET /mcp with event-stream Accept", () => {
    expect(checkRequest(req("GET", "/mcp", { accept: "text/event-stream" }), rc))
      .toEqual({ ok: true, route: "mcp" });
  });

  it("rejects GET /mcp without event-stream Accept as 405 GET, POST", () => {
    expect(checkRequest(req("GET", "/mcp"), rc))
      .toEqual({ ok: false, status: 405, reason: "method", allow: "GET, POST" });
  });

  it("rejects GET /mcp as 405 POST when getMode is 405", () => {
    expect(checkRequest(req("GET", "/mcp", { accept: "text/event-stream" }), { ...rc, getMode: "405" }))
      .toEqual({ ok: false, status: 405, reason: "method", allow: "POST" });
  });

  it("rejects DELETE /mcp as 405", () => {
    expect(checkRequest(req("DELETE", "/mcp", JSON_TYPE), rc))
      .toEqual({ ok: false, status: 405, reason: "method", allow: "GET, POST" });
  });

  it("accepts GET /healthz", () => {
    expect(checkRequest(req("GET", "/healthz"), rc)).toEqual({ ok: true, route: "healthz" });
  });

  it("rejects POST /healthz as 405 GET", () => {
    expect(checkRequest(req("POST", "/healthz"), rc))
      .toEqual({ ok: false, status: 405, reason: "method", allow: "GET" });
  });

  it.each(["/privacy", "/", "/nope"])("returns 404 for %s", (url) => {
    expect(checkRequest(req("GET", url), rc)).toEqual({ ok: false, status: 404, reason: "path" });
  });

  it("rejects a query string as 400", () => {
    expect(checkRequest(req("POST", "/mcp?x=1", JSON_TYPE), rc))
      .toEqual({ ok: false, status: 400, reason: "query" });
  });

  it("rejects an unknown host as 403", () => {
    expect(checkRequest(req("POST", "/mcp", { ...JSON_TYPE, host: "evil.example" }), rc))
      .toEqual({ ok: false, status: 403, reason: "host" });
  });

  it("rejects a missing host as 403", () => {
    expect(checkRequest(req("POST", "/mcp", { ...JSON_TYPE, host: undefined }), rc))
      .toEqual({ ok: false, status: 403, reason: "host" });
  });

  it("accepts an allowed host regardless of case and port", () => {
    expect(checkRequest(req("POST", "/mcp", { ...JSON_TYPE, host: "LOCALHOST:9999" }), rc))
      .toEqual({ ok: true, route: "mcp" });
  });

  it("accepts an IPv6 literal host with port", () => {
    expect(checkRequest(req("POST", "/mcp", { ...JSON_TYPE, host: "[::1]:8080" }), { ...rc, allowedHosts: ["[::1]"] }))
      .toEqual({ ok: true, route: "mcp" });
  });

  it("rejects a foreign origin in strict mode as 403", () => {
    expect(checkRequest(req("POST", "/mcp", { ...JSON_TYPE, origin: "https://evil.example" }), rc))
      .toEqual({ ok: false, status: 403, reason: "origin" });
  });

  it("reports a foreign origin in report mode", () => {
    expect(checkRequest(req("POST", "/mcp", { ...JSON_TYPE, origin: "https://evil.example" }), { ...rc, originPolicy: "report" }))
      .toEqual({ ok: true, route: "mcp", originReport: true });
  });

  it("accepts allowed origins", () => {
    expect(checkRequest(req("POST", "/mcp", { ...JSON_TYPE, origin: "https://claude.ai" }), rc))
      .toEqual({ ok: true, route: "mcp" });
    expect(checkRequest(req("POST", "/mcp", { ...JSON_TYPE, origin: "https://localhost" }), rc))
      .toEqual({ ok: true, route: "mcp" });
  });

  it("accepts a request without origin", () => {
    expect(checkRequest(req("POST", "/mcp", JSON_TYPE), rc)).toEqual({ ok: true, route: "mcp" });
  });

  describe("with bearer token", () => {
    const authRc: GuardConfig = { ...rc, bearerToken: TOKEN };

    it("rejects a missing authorization header as 401", () => {
      expect(checkRequest(req("POST", "/mcp", JSON_TYPE), authRc))
        .toEqual({ ok: false, status: 401, reason: "auth" });
    });

    it("rejects a wrong bearer token as 401", () => {
      expect(checkRequest(req("POST", "/mcp", { ...JSON_TYPE, authorization: "Bearer wrong" }), authRc))
        .toEqual({ ok: false, status: 401, reason: "auth" });
    });

    it("rejects a non-bearer scheme as 401", () => {
      expect(checkRequest(req("POST", "/mcp", { ...JSON_TYPE, authorization: "Basic x" }), authRc))
        .toEqual({ ok: false, status: 401, reason: "auth" });
    });

    it("accepts the correct bearer token", () => {
      expect(checkRequest(req("POST", "/mcp", { ...JSON_TYPE, authorization: `Bearer ${TOKEN}` }), authRc))
        .toEqual({ ok: true, route: "mcp" });
    });

    it("accepts a lowercase bearer scheme", () => {
      expect(checkRequest(req("POST", "/mcp", { ...JSON_TYPE, authorization: `bearer ${TOKEN}` }), authRc))
        .toEqual({ ok: true, route: "mcp" });
    });

    it("does not require a token for /healthz", () => {
      expect(checkRequest(req("GET", "/healthz"), authRc)).toEqual({ ok: true, route: "healthz" });
    });
  });

  it("does not inspect the MCP-Protocol-Version header", () => {
    expect(checkRequest(req("POST", "/mcp", { ...JSON_TYPE, "mcp-protocol-version": "1999-01-01" }), rc))
      .toEqual({ ok: true, route: "mcp" });
  });
});
