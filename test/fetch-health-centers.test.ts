import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { main } from "../scripts/fetch-health-centers.js";
import { parseApiManifest } from "../scripts/lib/health-centers-api.js";
import type { ScriptIO } from "../scripts/lib/script-io.js";

const KEY = "TESTKEY-abc123456789";
const fixture = (name: string): string => readFileSync(new URL(`./fixtures/health-centers/${name}`, import.meta.url), "utf8");
const pages: Record<string, string> = {
  "1": fixture("api/page-0001.json"),
  "2": fixture("api/page-0002.json"),
};
const roots: string[] = [];

const newRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), "hcf-"));
  roots.push(root);
  return root;
};

const dirUnder = (root: string): string => join(root, ".docs", "data-src", "15107750", "api");

const makeIo = (env: Record<string, string | undefined>, pageText: (pageNo: string) => string | undefined = (n) => pages[n]) => {
  const out: string[] = [];
  const err: string[] = [];
  const calls: URL[] = [];
  const io: ScriptIO = {
    env,
    fetch: (async (input: string | URL) => {
      const url = new URL(String(input));
      calls.push(url);
      const text = pageText(url.searchParams.get("pageNo") ?? "");
      if (text === undefined) throw new Error("unexpected page");
      return new Response(text, { status: 200 });
    }) as typeof fetch,
    now: () => new Date("2026-11-03T00:00:00Z"),
    stdout: (t) => out.push(t),
    stderr: (t) => err.push(t),
  };
  return { io, out, err, calls };
};

const fullArgs = (dir: string): string[] => ["--out-dir", dir, "--max-calls", "3", "--num-of-rows", "2"];

beforeAll(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error("global fetch disabled");
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

describe("health center API fetcher", () => {
  it("fetches all pages within budget", async () => {
    const root = newRoot();
    const dir = dirUnder(root);
    const run = makeIo({ DATA_GO_KR_SERVICE_KEY: KEY });
    expect(await main(fullArgs(dir), run.io, { root })).toBe(0);
    expect(run.calls).toHaveLength(2);
    for (const url of run.calls) {
      expect(url.host).toBe("api.data.go.kr");
      expect(url.pathname).toBe("/openapi/tn_pubr_public_ht_inst_api");
      expect(url.searchParams.get("type")).toBe("json");
      expect(url.searchParams.get("numOfRows")).toBe("2");
    }
    expect(existsSync(join(dir, "page-0001.json"))).toBe(true);
    expect(existsSync(join(dir, "page-0002.json"))).toBe(true);
    expect(existsSync(join(dir, "manifest.json"))).toBe(true);
    const manifest = parseApiManifest(readFileSync(join(dir, "manifest.json"), "utf8"));
    expect(manifest.complete).toBe(true);
    expect(manifest.items).toBe(3);
    expect(manifest.total_count).toBe(3);
    expect(run.out.join("")).toContain("호출: 2회 (예산 3회)");
  });

  it("never leaks the key", async () => {
    const root = newRoot();
    const dir = dirUnder(root);
    const run = makeIo({ DATA_GO_KR_SERVICE_KEY: KEY });
    expect(await main(fullArgs(dir), run.io, { root })).toBe(0);
    expect(run.out.join("")).not.toContain(KEY);
    expect(run.err.join("")).not.toContain(KEY);
    for (const name of readdirSync(dir)) {
      expect(readFileSync(join(dir, name), "utf8")).not.toContain(KEY);
    }
  });

  it("stops at the call budget", async () => {
    const root = newRoot();
    const dir = dirUnder(root);
    const run = makeIo({ DATA_GO_KR_SERVICE_KEY: KEY });
    expect(await main(["--out-dir", dir, "--max-calls", "1", "--num-of-rows", "2"], run.io, { root })).toBe(2);
    expect(run.calls).toHaveLength(1);
    expect(run.err.join("")).toContain("--max-calls");
    const manifest = parseApiManifest(readFileSync(join(dir, "manifest.json"), "utf8"));
    expect(manifest.complete).toBe(false);
  });

  it("requires the key", async () => {
    const root = newRoot();
    const dir = dirUnder(root);
    const run = makeIo({});
    expect(await main(fullArgs(dir), run.io, { root })).toBe(2);
    expect(run.calls).toHaveLength(0);
    expect(run.err.join("")).toContain("DATA_GO_KR_SERVICE_KEY");
  });

  it("reports quota exceeded", async () => {
    const root = newRoot();
    const dir = dirUnder(root);
    const quota = fixture("api-error-22.json");
    const run = makeIo({ DATA_GO_KR_SERVICE_KEY: KEY }, () => quota);
    expect(await main(fullArgs(dir), run.io, { root })).toBe(2);
    const err = run.err.join("");
    expect(err).toContain("22");
    expect(err).toContain("한도");
  });

  it("rejects an out-dir inside the repository outside .docs/data-src", async () => {
    const root = newRoot();
    const run = makeIo({ DATA_GO_KR_SERVICE_KEY: KEY });
    expect(await main(["--out-dir", join(root, "data", "x"), "--max-calls", "3"], run.io, { root })).toBe(1);
    expect(run.calls).toHaveLength(0);

    const relative = makeIo({ DATA_GO_KR_SERVICE_KEY: KEY });
    expect(await main(["--out-dir", "relative/dir", "--max-calls", "3"], relative.io, { root })).toBe(1);
    expect(relative.calls).toHaveLength(0);
  });

  it("refuses to overwrite without --force", async () => {
    const root = newRoot();
    const dir = dirUnder(root);
    const first = makeIo({ DATA_GO_KR_SERVICE_KEY: KEY });
    expect(await main(fullArgs(dir), first.io, { root })).toBe(0);

    const second = makeIo({ DATA_GO_KR_SERVICE_KEY: KEY });
    expect(await main(fullArgs(dir), second.io, { root })).toBe(1);
    expect(second.calls).toHaveLength(0);

    const forced = makeIo({ DATA_GO_KR_SERVICE_KEY: KEY });
    expect(await main([...fullArgs(dir), "--force"], forced.io, { root })).toBe(0);
  });

  it("rejects missing or out-of-range --max-calls", async () => {
    const root = newRoot();
    const dir = dirUnder(root);
    const missing = makeIo({ DATA_GO_KR_SERVICE_KEY: KEY });
    expect(await main(["--out-dir", dir], missing.io, { root })).toBe(1);
    expect(missing.calls).toHaveLength(0);

    const tooMany = makeIo({ DATA_GO_KR_SERVICE_KEY: KEY });
    expect(await main(["--out-dir", dir, "--max-calls", "51"], tooMany.io, { root })).toBe(1);
    expect(tooMany.calls).toHaveLength(0);
  });
});
