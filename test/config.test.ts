import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig, secretsOf } from "../src/core/config.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("loadConfig", () => {
  it("trims keys", () => {
    const config = loadConfig({ DATA_GO_KR_SERVICE_KEY: "  abcd1234  " });
    expect(config.keys.DATA_GO_KR).toBe("abcd1234");
  });

  it("empty and whitespace-only keys are unset", () => {
    const config = loadConfig({ DATA_GO_KR_SERVICE_KEY: "", KINDERGARTEN_API_KEY: "   " });
    expect("DATA_GO_KR" in config.keys).toBe(false);
    expect("KINDERGARTEN" in config.keys).toBe(false);
    expect(secretsOf(config)).toEqual([]);
  });

  it("reads SAFETYKOREA_AUTH_KEY trimmed", () => {
    expect(loadConfig({ SAFETYKOREA_AUTH_KEY: " fake " }).keys.SAFETYKOREA).toBe("fake");
  });

  it("treats empty SAFETYKOREA_AUTH_KEY as unset", () => {
    for (const value of ["", "   "]) {
      const config = loadConfig({ SAFETYKOREA_AUTH_KEY: value });
      expect("SAFETYKOREA" in config.keys).toBe(false);
      expect(secretsOf(config)).toEqual([]);
    }
  });

  it("defaults", () => {
    const config = loadConfig({});
    expect(config.maxResponseChars).toBe(8000);
    expect(config.httpTimeoutMs).toBe(8000);
    expect(config.lawCheckTimeoutMs).toBe(3000);
    expect(config.chainDeadlineMs).toBe(15000);
    expect(config.logLevel).toBe("warn");
  });

  it("clamps KPM_* values", () => {
    expect(loadConfig({ KPM_MAX_RESPONSE_CHARS: "10" }).maxResponseChars).toBe(1000);
    expect(loadConfig({ KPM_MAX_RESPONSE_CHARS: "999999" }).maxResponseChars).toBe(50000);
    expect(loadConfig({ KPM_MAX_RESPONSE_CHARS: "abc" }).maxResponseChars).toBe(8000);
    expect(loadConfig({ KPM_MAX_RESPONSE_CHARS: " 2000 " }).maxResponseChars).toBe(2000);
    expect(loadConfig({ KPM_HTTP_TIMEOUT_MS: "1" }).httpTimeoutMs).toBe(1000);
    expect(loadConfig({ KPM_HTTP_TIMEOUT_MS: "999999" }).httpTimeoutMs).toBe(60000);
    expect(loadConfig({ KPM_LAW_TIMEOUT_MS: "1" }).lawCheckTimeoutMs).toBe(500);
    expect(loadConfig({ KPM_CHAIN_DEADLINE_MS: "999999" }).chainDeadlineMs).toBe(60000);
    expect(loadConfig({ KPM_LOG_LEVEL: "DEBUG" }).logLevel).toBe("debug");
    expect(loadConfig({ KPM_LOG_LEVEL: "loud" }).logLevel).toBe("warn");
  });

  it("reads only the given env object", () => {
    vi.stubEnv("DATA_GO_KR_SERVICE_KEY", "fromprocessenv");
    expect(loadConfig({}).keys).toEqual({});
  });
});

describe("secretsOf", () => {
  it("returns configured keys", () => {
    const config = loadConfig({
      DATA_GO_KR_SERVICE_KEY: "key-one-1",
      KINDERGARTEN_API_KEY: "key-two-2",
      LAW_OC: "key_three",
      SAFETYKOREA_AUTH_KEY: "key-four-4",
    });
    expect([...secretsOf(config)].sort()).toEqual(["key-four-4", "key-one-1", "key-two-2", "key_three"].sort());
  });
});
