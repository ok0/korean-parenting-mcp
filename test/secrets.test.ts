import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "../src/core/logger.js";
import { maskKey, maskSecrets } from "../src/core/secrets.js";

const K = "ab+c/d=ef gh";
const ENC = encodeURIComponent(K);
const USP = new URLSearchParams({ k: K }).toString().slice(2);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("maskSecrets", () => {
  it("masks the raw, encodeURIComponent and URLSearchParams forms", () => {
    const text = `a ${K} b ${ENC} c ${USP} d`;
    const out = maskSecrets(text, [K]);
    expect(out).toBe("a *** b *** c *** d");
    expect(out).not.toContain(K);
    expect(out).not.toContain(ENC);
    expect(out).not.toContain(USP);
  });

  it("does not mask keys shorter than 4 characters", () => {
    const text = "value abc here";
    expect(maskSecrets(text, ["abc"])).toBe(text);
  });

  it("masks multiple keys at once", () => {
    expect(maskSecrets("x=AAAA y=BBBB", ["AAAA", "BBBB"])).toBe("x=*** y=***");
  });
});

describe("maskKey", () => {
  it("shows the first 4 characters and the length", () => {
    expect(maskKey("abcdefgh")).toBe("abcd…(8자)");
  });

  it("returns *** for keys shorter than 4 characters", () => {
    expect(maskKey("ab")).toBe("***");
  });
});

describe("createLogger", () => {
  it("writes masked lines to the sink with a trailing newline", () => {
    const lines: string[] = [];
    createLogger([K], "info", (l) => lines.push(l)).info(`v=${K}`);
    expect(lines).toHaveLength(1);
    const line = lines[0] ?? "";
    expect(line).not.toContain(K);
    expect(line).toContain("***");
    expect(line.endsWith("\n")).toBe(true);
  });

  it("discards debug lines at info level", () => {
    const lines: string[] = [];
    createLogger([K], "info", (l) => lines.push(l)).debug("hidden");
    expect(lines).toHaveLength(0);
  });

  it("default sink writes to stderr and never to stdout", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    createLogger([K], "info").info("hello");
    expect(stderrSpy).toHaveBeenCalled();
    expect(stdoutSpy).not.toHaveBeenCalled();
  });
});
