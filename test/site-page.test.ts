import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as vm from "node:vm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSiteBundle } from "../scripts/build-site.js";
import { findLeaks, secretsFromEnv } from "../scripts/lib/sample-mask.js";
import { ASSET_FILES } from "../scripts/visuals/generate.js";
import { assetPairs } from "../scripts/visuals/readme-figures.js";
import type { PageResult } from "../site/src/app.js";
import type { TimelineArgs } from "../src/timeline/input.js";
import { fakeDocument, type FakeElement } from "./helpers/fake-dom.js";
import { DEPLOY_TERMS, htmlText } from "./helpers/visuals.js";
import { OFFICIAL_CLAIM_OUTPUT, matchedPatterns } from "./helpers/wording.js";

interface Kpm {
  computeForPage(a: TimelineArgs, t: { y: number; m: number; d: number }): PageResult;
  kstToday(now: Date): { y: number; m: number; d: number };
  toTimelineArgs(v: { due: string; order: string; months: string }): TimelineArgs;
}

type OkResult = Extract<PageResult, { ok: true }>;

const root = fileURLToPath(new URL("../", import.meta.url));
const html = readFileSync(join(root, "site/index.html"), "utf8");
const css = readFileSync(join(root, "site/style.css"), "utf8");
const siteDir = join(root, "site");

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

const siteTs: Record<string, string> = {};
for (const f of readdirSync(join(siteDir, "src"))) {
  if (f.endsWith(".ts")) siteTs[f] = readFileSync(join(siteDir, "src", f), "utf8");
}
const allSiteTs = Object.values(siteTs).join("\n");

const text = htmlText(html);

function section(src: string, id: string): string {
  const start = src.indexOf(`<section id="${id}"`);
  const end = src.indexOf("</section>", start);
  return src.slice(start, end);
}

function loadWithDom(js: string, page: string): { kpm: Kpm; byId: (id: string) => FakeElement } {
  const fake = fakeDocument(page);
  const ctx = vm.createContext(
    { URL, document: fake.document },
    { codeGeneration: { strings: false, wasm: false } },
  );
  vm.runInContext(js, ctx, { filename: "app.js" });
  return { kpm: (ctx as unknown as { KPM: Kpm }).KPM, byId: fake.byId };
}

const dueInDays100 = (t0: { y: number; m: number; d: number }): string =>
  new Date(Date.UTC(t0.y, t0.m - 1, t0.d + 100)).toISOString().slice(0, 10);

describe("Pages page (M33)", () => {
  let js: string;
  const tmpDirs: string[] = [];

  beforeAll(async () => {
    js = (await buildSiteBundle({ write: false })).js;
  });

  afterAll(() => {
    for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
  });

  it("CSP meta has every directive", () => {
    const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)?.[1] ?? "";
    const directives = csp.split(";").map((d) => d.trim());
    for (const d of [
      "default-src 'none'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self'",
      "connect-src 'none'",
      "form-action 'none'",
      "base-uri 'none'",
    ]) {
      expect(directives).toContain(d);
    }
  });

  it("no inline code, forms, or external resources", () => {
    expect(html.match(/<script\b[^>]*>/g)).toEqual(['<script src="app.js" defer>']);
    expect(/<script\b[^>]*>\s*<\/script>/.test(html)).toBe(true);
    expect(/<style\b/i.test(html)).toBe(false);
    expect(/\sstyle=/i.test(html)).toBe(false);
    expect(/\son[a-z]+=/i.test(html)).toBe(false);
    expect(/<form\b/i.test(html)).toBe(false);
    expect(/<iframe\b/i.test(html)).toBe(false);
    for (const m of html.matchAll(/\s(?:src|srcset)="([^"]*)"/g)) {
      const v = m[1] ?? "";
      expect(v.startsWith("http") || v.startsWith("/"), v).toBe(false);
    }
    for (const m of html.matchAll(/<link\b[^>]*\bhref="([^"]*)"/g)) {
      const v = m[1] ?? "";
      expect(v.startsWith("http") || v.startsWith("/"), v).toBe(false);
    }
    const analytics = /gtag|googletagmanager|google-analytics|analytics|plausible|umami|matomo|hotjar|clarity/i;
    expect(analytics.test(html)).toBe(false);
    expect(analytics.test(css)).toBe(false);
    expect(analytics.test(allSiteTs)).toBe(false);
    expect(/@import|url\(|https?:/.test(css)).toBe(false);
  });

  it("no keys, deploy terms, or official claims", () => {
    const all = html + "\n" + css + "\n" + allSiteTs;
    expect(findLeaks(all, secretsFromEnv(process.env), { heuristic: true })).toEqual([]);
    expect(matchedPatterns(text, DEPLOY_TERMS)).toEqual([]);
    const deployWord = /run\.app|Cloud\s*Run|gcloud|Docker|deploy/i;
    expect(deployWord.test(html)).toBe(false);
    expect(deployWord.test(css)).toBe(false);
    expect(deployWord.test(allSiteTs)).toBe(false);
    expect(deployWord.test(js)).toBe(false);
    expect(matchedPatterns(text, OFFICIAL_CLAIM_OUTPUT)).toEqual([]);
  });

  it("required notices", () => {
    for (const phrase of [
      "비공식",
      "출처",
      "기준일",
      "면책",
      "브라우저 안에서만",
      "전송·저장되지 않습니다",
      "고정된 기준일",
      "오늘 날짜",
    ]) {
      expect(text, phrase).toContain(phrase);
    }
    const header = html.slice(html.indexOf('<header id="notice"'), html.indexOf("</header>"));
    const headerText = htmlText(header);
    for (const phrase of ["비공식", "의료", "법률"]) {
      expect(headerText, phrase).toContain(phrase);
    }
    expect(html.indexOf('<header id="notice"')).toBeLessThan(html.indexOf("<picture"));
    expect(/\d{4}-\d{2}-\d{2}/.test(text)).toBe(false);
    expect(/\d[\d,]*\s*만?원/.test(text)).toBe(false);
  });

  it("figures a-d use picture with relative assets", () => {
    const pairs = assetPairs(ASSET_FILES);
    const pictures = html.match(/<picture>[\s\S]*?<\/picture>/g) ?? [];
    expect(pictures.length).toBe(pairs.length);
    pairs.forEach((p, i) => {
      const block = pictures[i] ?? "";
      expect(block).toContain(`<source media="(prefers-color-scheme: dark)" srcset="assets/${p.dark}">`);
      const alt = new RegExp(`<img src="assets/${p.light}" alt="([^"]+)"`).exec(block)?.[1] ?? "";
      expect(alt.trim()).not.toBe("");
    });
    for (const m of html.matchAll(/assets\/[^"\s]+\.svg/g)) {
      expect(existsSync(join(root, m[0])), m[0]).toBe(true);
    }
  });

  it("report example section is static", () => {
    const s = section(html, "report-example");
    const sText = htmlText(s);
    for (const phrase of ["한 장 보고서 예시", "AI 도우미", "정적 예시", "개인 맞춤이 아니", "입력을 받지 않"]) {
      expect(sText, phrase).toContain(phrase);
    }
    expect(s).toContain("assets/report-example-light.svg");
    expect(s).toContain("assets/report-example-dark.svg");
    expect(/<(input|button|select|textarea)\b/i.test(s)).toBe(false);
  });

  it("trial controls match main.ts ids", () => {
    const t = section(html, "try");
    for (const frag of [
      '<input type="date" id="due-date">',
      '<select id="birth-order">',
      '<select id="months-ahead">',
      '<button type="button" id="compute">',
      'id="cards"',
      'id="error"',
      'id="result"',
      'id="as-of"',
      '<pre id="raw-text">',
      "원문 그대로 보기",
      "예시·참고용",
      "개인 맞춤이 아닙니다",
      "관할 기관",
      "의료진",
    ]) {
      expect(t, frag).toContain(frag);
    }
    const monthsBlock = /<select id="months-ahead">([\s\S]*?)<\/select>/.exec(html)?.[1] ?? "";
    const values = [...monthsBlock.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
    expect(values).toEqual(["12", "36", "84"]);
    const idsBody = /const IDS = \{([\s\S]*?)\} as const/.exec(siteTs["main.ts"] ?? "")?.[1] ?? "";
    const idValues = [...idsBody.matchAll(/:\s*"([a-z-]+)"/g)].map((m) => m[1] ?? "");
    expect(idValues.length).toBeGreaterThan(0);
    for (const v of idValues) {
      expect(html, v).toContain(`id="${v}"`);
    }
  });

  it("site code uses no forbidden APIs", () => {
    const forbidden =
      /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new Function|localStorage|sessionStorage|indexedDB|document\.cookie|\bfetch\b|XMLHttpRequest|sendBeacon/;
    for (const [name, src] of Object.entries(siteTs)) {
      expect(forbidden.test(src), name).toBe(false);
    }
    const main = siteTs["main.ts"] ?? "";
    expect(main).toContain('typeof document !== "undefined"');
    expect(main.split("new Date(").length - 1).toBe(1);
    expect(/getFullYear|getMonth|getDate|setDate|toISOString|toLocale|\.style\b/.test(main)).toBe(false);
    expect(listFiles(siteDir).some((f) => f.endsWith(".md"))).toBe(false);
  });

  it("toTimelineArgs maps form values", () => {
    const { kpm } = loadWithDom(js, html);
    expect(
      JSON.parse(JSON.stringify(kpm.toTimelineArgs({ due: "2027-02-10", order: "2", months: "36" }))),
    ).toEqual({ due_date: "2027-02-10", birth_order: 2, months_ahead: 36 });
    expect(JSON.parse(JSON.stringify(kpm.toTimelineArgs({ due: " ", order: "", months: "12" })))).toEqual({
      months_ahead: 12,
    });
  });

  it("button renders cards and raw text (fake DOM)", () => {
    const { kpm, byId } = loadWithDom(js, html);
    const t0 = kpm.kstToday(new Date());
    const due = dueInDays100(t0);
    byId("due-date").value = due;
    byId("birth-order").value = "1";
    byId("months-ahead").value = "12";
    byId("compute").dispatch("click");
    const r = kpm.computeForPage({ due_date: due, birth_order: 1, months_ahead: 12 }, kpm.kstToday(new Date())) as OkResult;
    expect(r.ok).toBe(true);
    expect(r.cards.length).toBeGreaterThan(0);
    expect(byId("cards").children.length).toBe(r.cards.length);
    expect(byId("raw-text").textContent).toBe(r.text);
    expect(byId("result").hidden).toBe(false);
    expect(byId("error").hidden).toBe(true);
    expect(byId("as-of").textContent).toContain(r.asOf);
    const first = r.cards[0];
    expect(first).toBeDefined();
    if (!first) return;
    expect(byId("cards").children[0]?.textContent).toContain(first.title);
    expect(byId("cards").children[0]?.textContent).toContain(first.date);
  });

  it("invalid and empty input show the get_timeline error (fake DOM)", () => {
    const { kpm, byId } = loadWithDom(js, html);
    byId("due-date").value = "2099-01-01";
    byId("birth-order").value = "";
    byId("months-ahead").value = "12";
    byId("compute").dispatch("click");
    const expected = kpm.computeForPage({ due_date: "2099-01-01", months_ahead: 12 }, kpm.kstToday(new Date()));
    expect(expected.ok).toBe(false);
    if (expected.ok) return;
    expect(byId("error").hidden).toBe(false);
    expect(byId("error").textContent).toBe(expected.message);
    expect(byId("error").textContent).toContain("출산예정일");
    expect(byId("result").hidden).toBe(true);
    expect(byId("cards").children.length).toBe(0);

    byId("due-date").value = "";
    byId("compute").dispatch("click");
    expect(byId("error").textContent).toBe("due_date(출산예정일) 또는 birth_date(생년월일) 중 하나가 필요합니다.");
  });

  it("build output holds the page and every local reference", async () => {
    const outA = mkdtempSync(join(tmpdir(), "kpm-page-"));
    const outB = mkdtempSync(join(tmpdir(), "kpm-page-"));
    tmpDirs.push(outA, outB);
    await buildSiteBundle({ write: true, outdir: outA });

    const files = listFiles(outA);
    expect(files).toContain("index.html");
    expect(files).toContain("style.css");
    expect(files).toContain("app.js");
    for (const f of files) {
      expect(
        f === "app.js" || f === "index.html" || f === "style.css" || /^assets\/[^/]+\.svg$/.test(f),
        f,
      ).toBe(true);
    }

    const built = readFileSync(join(outA, "index.html"), "utf8");
    for (const m of built.matchAll(/\s(?:src|srcset|href)="([^"]*)"/g)) {
      const v = m[1] ?? "";
      if (v.startsWith("http") || v.startsWith("#")) continue;
      expect(existsSync(join(outA, v)), v).toBe(true);
    }

    await buildSiteBundle({ write: true, outdir: outB });
    const again = listFiles(outB);
    expect(again).toEqual(files);
    for (const f of files) {
      expect(readFileSync(join(outA, f)).equals(readFileSync(join(outB, f))), f).toBe(true);
    }
  });
});
