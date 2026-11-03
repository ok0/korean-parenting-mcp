import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import * as vm from "node:vm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSiteBundle, checkBundle } from "../scripts/build-site.js";
import { ToolError } from "../src/core/errors.js";
import { getTimelineTool } from "../src/tools/get-timeline.js";
import { computeOfflineTimeline } from "../src/timeline/offline.js";
import { formatDate } from "../src/date/civil-date.js";
import type { TimelineArgs } from "../src/timeline/input.js";
import { createTestContext } from "./helpers/context.js";
import { pickRegion } from "./helpers/health-center-picks.js";
import { CLIENT_BRANDS } from "./helpers/visuals.js";

interface Kpm {
  computeForPage(
    a: TimelineArgs,
    t: { y: number; m: number; d: number },
  ): { ok: boolean; text?: string; cards?: Array<Record<string, unknown>>; asOf?: string; message?: string };
  kstToday(now: Date): { y: number; m: number; d: number };
}

const root = fileURLToPath(new URL("../", import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
  files: string[];
};
const isGitRepo = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: root }).status === 0;

const TODAY = { y: 2026, m: 1, d: 1 };

const SAMPLES: TimelineArgs[] = [
  { due_date: "2027-01-31", reference_date: "2026-06-30" },
  { due_date: "2028-02-29", reference_date: "2027-06-01" },
  { due_date: "2026-09-25", reference_date: "2026-01-01", include_past: true },
  { due_date: "2026-10-28" },
  { due_date: "2026-01-01", reference_date: "2026-04-01", include_past: true },
  { due_date: "2027-02-10", reference_date: "2026-10-28", birth_order: 2, fetus_count: 2, region: "성동구", months_ahead: 36 },
  { due_date: "2027-03-15", reference_date: "2026-06-08", months_ahead: 84, include_past: true },
  { due_date: "2027-05-05", reference_date: "2026-10-28", birth_order: 2, months_ahead: 12 },
  { due_date: "2026-12-25", reference_date: "2026-10-28", birth_order: 3, months_ahead: 24 },
  { birth_date: "2026-05-28", reference_date: "2026-10-28" },
  { birth_date: "2025-12-31", reference_date: "2026-03-15", months_ahead: 24, include_past: true, region: "성동구", birth_order: 3 },
  { birth_date: "2026-01-31", reference_date: "2026-02-01", fetus_count: 2 },
  { birth_date: "2026-05-28", reference_date: "2026-10-28", region: pickRegion((l) => l.kind === "found")!.text },
];

const INVALID: TimelineArgs[] = [
  { due_date: "2027-02-10", birth_date: "2026-01-31", reference_date: "2026-10-28" },
  { reference_date: "2026-10-28" },
  { due_date: "2026-10-29", reference_date: "2026-01-01" },
  { due_date: "2025-12-31", reference_date: "2026-04-01" },
  { birth_date: "2026-03-01", reference_date: "2026-02-01" },
] as TimelineArgs[];

const expectedText = (o: { body: string; footer?: string }) =>
  o.footer ? o.body + "\n\n" + o.footer : o.body;

function loadKpm(code: string): { kpm: Kpm; ctx: vm.Context } {
  const ctx = vm.createContext({ URL }, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(code, ctx, { filename: "app.js" });
  return { kpm: (ctx as unknown as { KPM: Kpm }).KPM, ctx };
}

function listFiles(dir: string, rel = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(dir, rel)).sort()) {
    const childRel = rel === "" ? name : `${rel}/${name}`;
    if (statSync(join(dir, childRel)).isDirectory()) {
      out.push(...listFiles(dir, childRel));
    } else {
      out.push(childRel);
    }
  }
  return out;
}

describe("site bundle", () => {
  let js: string;
  let kpm: Kpm;
  let ctx: vm.Context;
  const tmpDirs: string[] = [];

  beforeAll(async () => {
    js = (await buildSiteBundle({ write: false })).js;
    ({ kpm, ctx } = loadKpm(js));
  });

  afterAll(() => {
    for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
  });

  it("builds a browser IIFE without node imports", () => {
    expect(/^(?:"use strict";\n)?var KPM = /.test(js)).toBe(true);
    expect(/["']node:[a-z]/.test(js)).toBe(false);
    expect(js.includes("readFileSync")).toBe(false);
    expect(js.includes("function makeDataStore(")).toBe(true);
    expect(checkBundle(js, [])).toEqual([]);
    expect(checkBundle("x", ["node:fs"]).length).toBeGreaterThan(0);
    expect(checkBundle("x", ["src/data-store/load.ts"]).length).toBeGreaterThan(0);
    expect(checkBundle("fetch(u)", []).length).toBeGreaterThan(0);
  });

  it("runs in an isolated context without process, require or fetch", () => {
    for (const g of ["process", "require", "fetch", "XMLHttpRequest"]) {
      expect(vm.runInContext("typeof " + g, ctx)).toBe("undefined");
    }
    expect(typeof kpm.computeForPage).toBe("function");
    expect(JSON.parse(JSON.stringify(kpm.kstToday(new Date("2025-12-31T15:00:00Z"))))).toEqual({
      y: 2026,
      m: 1,
      d: 1,
    });
  });

  it("matches keyless get_timeline text for 13 samples", async () => {
    expect(SAMPLES.length).toBeGreaterThanOrEqual(8);
    for (const s of SAMPLES) {
      const on = await getTimelineTool.handler(s as never, createTestContext());
      const r = kpm.computeForPage(s, TODAY);
      expect(r.ok).toBe(true);
      expect(r.text).toBe(expectedText(on));
      expect(r.asOf).toBe("2026-01-01");
    }
  });

  it("cards mirror timeline items", () => {
    for (const s of SAMPLES) {
      const items = computeOfflineTimeline(s, TODAY).result.items;
      const r = kpm.computeForPage(s, TODAY);
      const cards = r.cards ?? [];
      expect(items.length).toBeGreaterThan(0);
      expect(cards.length).toBe(items.length);
      items.forEach((item, i) => {
        const card = cards[i] as Record<string, unknown>;
        expect(card.title).toBe(item.title);
        expect(card.date).toBe(formatDate(item.start));
        expect(card.category).toBe(item.category);
        for (const v of Object.values(card)) {
          expect(v === null || typeof v === "string").toBe(true);
        }
      });
    }
  });

  it("returns the same error message as get_timeline", async () => {
    for (const s of INVALID) {
      let onErr: unknown;
      try {
        await getTimelineTool.handler(s as never, createTestContext());
      } catch (e) {
        onErr = e;
      }
      expect(onErr).toBeInstanceOf(ToolError);
      const r = kpm.computeForPage(s, TODAY);
      expect(r.ok).toBe(false);
      expect(r.message).toBe((onErr as ToolError).message);
    }
  });

  it("contains no network, storage, key names or client brands", () => {
    const forbidden = [
      "fetch(",
      "XMLHttpRequest",
      "sendBeacon",
      "WebSocket",
      "EventSource",
      "process.env",
      "DATA_GO_KR_SERVICE_KEY",
      "KINDERGARTEN_API_KEY",
      "LAW_OC",
      "SAFETYKOREA_AUTH_KEY",
      "localStorage",
      "sessionStorage",
      "indexedDB",
      ".ensemble",
      ".docs/",
    ];
    for (const token of forbidden) {
      expect(js.includes(token), token).toBe(false);
    }
    for (const re of CLIENT_BRANDS) {
      expect(re.test(js), String(re)).toBe(false);
    }
  });

  it("build is deterministic and writes only site files", async () => {
    expect((await buildSiteBundle({ write: false })).js).toBe(js);

    const outdir = mkdtempSync(join(tmpdir(), "kpm-site-"));
    tmpDirs.push(outdir);
    await buildSiteBundle({ write: true, outdir });
    const first = readFileSync(join(outdir, "app.js"), "utf8");
    await buildSiteBundle({ write: true, outdir });
    const second = readFileSync(join(outdir, "app.js"), "utf8");
    expect(second).toBe(first);

    const files = listFiles(outdir);
    for (const f of files) {
      expect(f === "app.js" || f === "index.html" || f === "style.css" || /^assets\/[^/]+\.svg$/.test(f), f).toBe(true);
    }
    expect(second).toBe(js);

    const outAssets = files
      .filter((f) => f.startsWith("assets/"))
      .map((f) => f.slice("assets/".length))
      .sort();
    const repoAssets = readdirSync(join(root, "assets"))
      .filter((n) => n.endsWith(".svg"))
      .sort();
    expect(outAssets).toEqual(repoAssets);
  });

  it.skipIf(!isGitRepo)("build output is git-ignored", () => {
    expect(spawnSync("git", ["check-ignore", "-q", "build-site/app.js"], { cwd: root }).status).toBe(0);
  });

  it("typecheck covers the site and package files exclude site output", () => {
    expect(pkg.scripts.typecheck).toContain("tsconfig.site.json");
    expect(pkg.scripts["build:site"]).toContain("build-site.js");
    expect(pkg.files.some((f) => f.startsWith("site") || f.startsWith("build-site"))).toBe(false);
  });
});
