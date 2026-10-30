import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { XMLValidator } from "fast-xml-parser";
import { describe, expect, it } from "vitest";
import { SPECS } from "../src/clients/data-go-kr-specs.js";
import { addDays, addMonthsClamp, compare, formatDate, parseDate, type CivilDate } from "../src/date/civil-date.js";
import { daycareStage } from "../src/daycare/guide.js";
import { allTools, type ToolDef } from "../src/tools/registry.js";
import { lmpFromDue } from "../src/timeline/rules/prenatal.js";
import type { TimelineItem } from "../src/timeline/types.js";
import { findLeaks, secretsFromEnv } from "../scripts/lib/sample-mask.js";
import { EXAMPLE, exampleTimeline } from "../scripts/visuals/example.js";
import { ASSET_FILES, FIGURES, PREVIEW_PATH, buildAll, diffAssets, previewHtml } from "../scripts/visuals/generate.js";
import { facilityMarks, laneOf, renderLifeTimeline, stageBands } from "../scripts/visuals/life-timeline.js";
import { TOOL_LABELS, assertLabelsCover, sourceKind } from "../scripts/visuals/labels.js";
import { buildStories } from "../scripts/visuals/stories.js";
import { THEMES, estimateWidth, stackBaselines, textBlock, textPairs } from "../scripts/visuals/theme.js";
import {
  ANSWER_FORBIDDEN,
  DEPLOY_TERMS,
  FIGURE_MEDICAL_FORBIDDEN,
  PLAIN_FORBIDDEN,
  SNAKE_ID,
  contrast,
  isoDates,
  textElements,
  visibleText,
} from "./helpers/visuals.js";
import {
  ASSERTIVE_SAFETY,
  CLINIC_ASSERT,
  OFFICIAL_CLAIM_META,
  OFFICIAL_CLAIM_OUTPUT,
  matchedPatterns,
} from "./helpers/wording.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const built = await buildAll();

function must<T>(v: T | null | undefined, what: string): T {
  if (v === undefined || v === null) throw new Error(`없음: ${what}`);
  return v;
}

function svgOf(f: string): string {
  return must(built[f], f);
}

function descOf(svg: string): string {
  return must(/<desc id="desc">([\s\S]*?)<\/desc>/.exec(svg)?.[1], "desc");
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function allowedDates(t: ReturnType<typeof exampleTimeline>): Set<string> {
  const birth = t.view.birthDate;
  const dates: string[] = [formatDate(birth), formatDate(t.view.referenceDate)];
  for (const item of t.result.items) {
    dates.push(formatDate(item.start));
    if (item.end !== undefined) dates.push(formatDate(item.end));
    dates.push(item.provenance.as_of);
  }
  for (const m of facilityMarks(birth)) dates.push(formatDate(m.date));
  for (const b of stageBands(birth)) dates.push(formatDate(b.start), formatDate(b.end));
  return new Set(dates);
}

describe("visual assets (M30)", () => {
  it("buildAll is deterministic and matches committed assets", async () => {
    expect(Object.keys(built)).toEqual([...ASSET_FILES]);
    expect(await buildAll()).toEqual(built);
    for (const f of ASSET_FILES) {
      expect(readFileSync(join(root, "assets", f), "utf8"), f).toBe(svgOf(f));
    }
  });

  it("every svg is valid xml, accessible, opaque and self-contained", () => {
    for (const f of ASSET_FILES) {
      const svg = svgOf(f);
      expect(XMLValidator.validate(svg), f).toBe(true);
      expect(/<svg[^>]*\brole="img"/.test(svg), f).toBe(true);
      expect(/<title id="title">[^<]+<\/title>/.test(svg), f).toBe(true);
      expect(/<desc id="desc">[\s\S]+<\/desc>/.test(svg), f).toBe(true);
      const size = must(/<svg\b[^>]*?\swidth="([^"]+)" height="([^"]+)"/.exec(svg), `${f} size`);
      const w = size[1] ?? "";
      const h = size[2] ?? "";
      const rect = new RegExp(
        `</desc>\\n<rect x="0" y="0" width="${escapeRe(w)}" height="${escapeRe(h)}" fill="#[0-9A-Fa-f]{6}"/>`,
      );
      expect(rect.test(svg), f).toBe(true);
      const inner = svg.replace('xmlns="http://www.w3.org/2000/svg"', "");
      for (const bad of [/https?:/i, /<image\b/, /<script\b/, /<foreignObject\b/, /@import/, /@font-face/, /url\(/i, /xlink:href/]) {
        expect(bad.test(inner), `${f}: ${bad.source}`).toBe(false);
      }
      expect(/<text[^>]*>[^<\s]/.test(svg), f).toBe(false);
    }
  });

  it("diffAssets reports changed, missing and extra svg files and ignores gifs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kpm-visuals-"));
    try {
      for (const f of ASSET_FILES) writeFileSync(join(dir, f), svgOf(f));
      expect(await diffAssets(dir)).toEqual([]);

      writeFileSync(join(dir, "demo-1.gif"), "GIF89a");
      expect(await diffAssets(dir)).toEqual([]);

      const dark = join(dir, "tool-map-dark.svg");
      writeFileSync(dark, `${svgOf("tool-map-dark.svg")}<!-- x -->`);
      expect(await diffAssets(dir)).toEqual(["tool-map-dark.svg"]);
      writeFileSync(dark, svgOf("tool-map-dark.svg"));

      const life = join(dir, "life-timeline-light.svg");
      rmSync(life);
      expect(await diffAssets(dir)).toEqual(["life-timeline-light.svg"]);
      writeFileSync(life, svgOf("life-timeline-light.svg"));

      writeFileSync(join(dir, "extra.svg"), "<svg/>");
      expect(await diffAssets(dir)).toEqual(["extra.svg"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("theme text pairs reach 4.5:1", () => {
    for (const theme of [THEMES.light, THEMES.dark]) {
      for (const [fg, bg, label] of textPairs(theme)) {
        expect(contrast(fg, bg), `${theme.name} ${label}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("tool labels match the registry exactly", () => {
    expect(Object.keys(TOOL_LABELS).sort()).toEqual(allTools.map((t) => t.name).sort());
    expect(() => assertLabelsCover(allTools)).not.toThrow();
    const base = must(allTools[0], "첫 도구");
    expect(() => assertLabelsCover([...allTools, { ...base, name: "extra_tool" }])).toThrow(/extra_tool/);
    expect(() => assertLabelsCover(allTools.slice(1))).toThrow(/get_timeline/);
    for (const t of allTools) {
      expect(sourceKind(t), t.name).toBe(t.requiredKeys?.length ? "live-key" : "builtin");
    }
    expect(sourceKind(must(allTools.find((t) => t.name === "get_timeline"), "get_timeline"))).toBe("builtin");
  });

  it("tool map hides ids, shows the real count and marks only keyed tools", () => {
    for (const f of ["tool-map-light.svg", "tool-map-dark.svg"]) {
      const svg = svgOf(f);
      const v = visibleText(svg);
      expect(v, f).toContain(`도구 ${allTools.length}개`);
      expect(v, f).toContain("미리 담아 둔 정보");
      expect(v, f).toContain("공공기관에서 바로 확인");
      for (const t of allTools) {
        expect(svg, `${f} ${t.name}`).toContain(`data-tool="${t.name}"`);
        expect(descOf(svg), t.name).toContain(t.name);
        expect(v, t.name).not.toContain(t.name);
        const m = new RegExp(`<g data-tool="${t.name}"([^>]*)>([\\s\\S]*?)</g>`).exec(svg);
        const attrs = m?.[1] ?? "";
        const body = m?.[2] ?? "";
        expect(m, t.name).not.toBeNull();
        expect(attrs.includes('data-key="required"'), t.name).toBe(Boolean(t.requiredKeys?.length));
        expect(body.includes("신청 필요"), t.name).toBe(Boolean(t.requiredKeys?.length));
      }
      expect(svg.match(/<g data-tool=/g)?.length ?? 0, f).toBe(allTools.length);
    }
  });

  it("life timeline dates come only from the computed example", () => {
    const t = exampleTimeline();
    const birth = t.view.birthDate;
    const lmp = lmpFromDue(birth);
    expect(EXAMPLE.reference_date).toBe(formatDate(lmpFromDue(parseDate(EXAMPLE.due_date))));
    const allowed = allowedDates(t);
    const limit = addMonthsClamp(birth, 72);
    const maxAsOf = t.result.items.map((i) => i.provenance.as_of).reduce((a, b) => (b > a ? b : a), "");
    const holidayYears = t.result.items
      .flatMap((i) => i.notes)
      .map((n) => /^(\d{4})년 공휴일 정보 없음/.exec(n)?.[1])
      .filter((y): y is string => y !== undefined);

    for (const f of ["life-timeline-light.svg", "life-timeline-dark.svg"]) {
      const svg = svgOf(f);
      const v = visibleText(svg);
      for (const d of isoDates(v)) expect(allowed.has(d), `${f} ${d}`).toBe(true);
      for (const m of v.matchAll(/(\d{4})년/g)) {
        const y = Number(m[1]);
        expect(y >= lmp.y && y <= birth.y + 6, `${f} ${m[0]}`).toBe(true);
      }
      for (const word of ["예시", "개인 맞춤 아님", "비공식", "관할 기관", "의료진"]) {
        expect(v, `${f} ${word}`).toContain(word);
      }
      expect(v, f).toContain(`데이터 기준일 ${maxAsOf}`);
      for (const item of t.result.items) {
        if (compare(item.start, limit) <= 0) {
          expect(svg, `${f} ${item.id}`).toContain(`data-item="${item.id}"`);
        }
      }
      if (holidayYears.length > 0) {
        expect(v, f).toContain("공휴일 정보");
        for (const y of holidayYears) expect(v, `${f} ${y}`).toContain(`${y}년`);
      }
    }

    for (const item of t.result.items) {
      expect(() => laneOf(item), item.id).not.toThrow();
    }
    const first = must(t.result.items[0], "첫 항목");
    expect(() => laneOf({ ...first, category: "검진", id: "unknown" } as TimelineItem)).toThrow();
  });

  it("life timeline changes with a different example", () => {
    const due = "2027-08-20";
    const ref = formatDate(addDays(parseDate(due), -280));
    const t2 = exampleTimeline({ ...EXAMPLE, due_date: due, reference_date: ref });
    const svg2 = renderLifeTimeline(t2, THEMES.light);
    expect(svg2).not.toBe(svgOf("life-timeline-light.svg"));
    expect(svg2).toContain(due);
  });

  it("facility marks follow daycare stage boundaries", () => {
    const birth: CivilDate = exampleTimeline().view.birthDate;
    const marks = facilityMarks(birth);
    const offsets = [0, 12, 24, 36];
    marks.forEach((mark, i) => {
      const expected = addMonthsClamp(birth, must(offsets[i], `offset ${i}`));
      expect(formatDate(mark.date), mark.stage).toBe(formatDate(expected));
      expect(daycareStage({ birth }, mark.date), mark.stage).toMatchObject({ ok: true, stage: mark.stage });
      if (i > 0) {
        const prev = must(marks[i - 1], `mark ${i - 1}`);
        expect(daycareStage({ birth }, addDays(mark.date, -1)), mark.stage).toMatchObject({
          ok: true,
          stage: prev.stage,
        });
      }
    });
  });

  it("stories use real tools, real sources and example-only answers", () => {
    const t = exampleTimeline();
    const stories = buildStories(allTools, t);
    expect(stories).toHaveLength(3);
    expect(stories.map((s) => s.tool)).toEqual(["find_night_pediatric", "get_timeline", "check_recall"]);
    for (const s of stories) {
      const tool = must(allTools.find((x) => x.name === s.tool), s.tool);
      expect(s.sourceName === null, s.tool).toBe(s.kind === "builtin");
      if (s.sourceName !== null) {
        expect(tool.title, s.tool).toContain(s.sourceName);
        expect(tool.description, s.tool).toContain(s.sourceName);
      }
      expect(s.answer.startsWith("예시"), s.tool).toBe(true);
      expect(matchedPatterns(s.answer, ANSWER_FORBIDDEN), s.tool).toEqual([]);
      expect(CLINIC_ASSERT.test(s.answer), s.tool).toBe(false);
      expect(ASSERTIVE_SAFETY.test(s.answer), s.tool).toBe(false);
    }
    const s1 = must(stories[0], "이야기 1");
    expect(s1.sourceName).not.toBeNull();
    expect(SPECS.nemcMoonlight.attribution.includes(s1.sourceName ?? "")).toBe(true);

    const s2 = must(stories[1], "이야기 2");
    const allowed = allowedDates(t);
    for (const d of isoDates(`${s2.question}${s2.answer}`)) expect(allowed.has(d), d).toBe(true);

    for (const f of ["question-stories-light.svg", "question-stories-dark.svg"]) {
      const svg = svgOf(f);
      for (const n of ["1", "2", "3"]) expect(svg, `${f} ${n}`).toContain(`data-story="${n}"`);
      for (const s of stories) expect(svg, `${f} ${s.tool}`).toContain(`data-tool="${s.tool}"`);
    }

    expect(() => buildStories(allTools.filter((t) => t.name !== "check_recall"), t)).toThrow();
    expect(() =>
      buildStories(
        allTools.map((t) => (t.name === "find_night_pediatric" ? { ...t, title: "X" } : t)),
        t,
      ),
    ).toThrow();
  });

  it("visible text is plain and free of key, deployment and official-claim wording", () => {
    const secrets = secretsFromEnv(process.env).filter((s) => s.length >= 8);
    for (const f of ASSET_FILES) {
      const svg = svgOf(f);
      const v = visibleText(svg);
      expect(matchedPatterns(v, PLAIN_FORBIDDEN), f).toEqual([]);
      expect(matchedPatterns(v, DEPLOY_TERMS), f).toEqual([]);
      expect(SNAKE_ID.test(v), f).toBe(false);
      // report lines are verbatim tool output, where the link name 아이사랑 is allowed (as in OFFICIAL_CLAIM_OUTPUT)
      const meta = f.startsWith("report-example-") ? OFFICIAL_CLAIM_META.filter((p) => p.source !== "아이사랑") : OFFICIAL_CLAIM_META;
      expect(matchedPatterns(v, meta), f).toEqual([]);
      expect(matchedPatterns(v, OFFICIAL_CLAIM_OUTPUT), f).toEqual([]);
      expect(matchedPatterns(v, FIGURE_MEDICAL_FORBIDDEN), f).toEqual([]);
      expect(findLeaks(svg, secrets, { heuristic: true }), f).toEqual([]);
    }
  });

  it("every text element fits its estimated box", () => {
    for (const f of ASSET_FILES) {
      const svg = svgOf(f);
      const total = svg.match(/<text\b/g)?.length ?? 0;
      const els = textElements(svg);
      expect(els.filter((e) => Number.isFinite(e.maxW)).length, f).toBe(total);
      for (const e of els) {
        for (const line of e.lines) {
          expect(estimateWidth(line, e.fontSize, e.bold), `${f}: ${line}`).toBeLessThanOrEqual(e.maxW + 0.05);
        }
      }
    }
    expect(() =>
      textBlock({ x: 0, y: 0, text: "아주 긴 한국어 문장이 상자를 넘칩니다", maxWidth: 40, fontSize: 14, fill: "#000000" }),
    ).toThrow(/글자 넘침/);
    expect(() =>
      textBlock({ x: 0, y: 0, text: ["가나다라마바사아자차"], maxWidth: 50, fontSize: 14, fill: "#000000" }),
    ).toThrow(/글자 넘침/);
  });

  it("package dependencies are unchanged", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies).sort()).toEqual(["@modelcontextprotocol/sdk", "fast-xml-parser", "zod"]);
    expect(Object.keys(pkg.devDependencies).sort()).toEqual([
      "@anthropic-ai/mcpb",
      "@types/node",
      "esbuild",
      "pdfjs-dist",
      "typescript",
      "vitest",
    ]);
    expect(pkg.scripts.visuals).toBeDefined();
    expect(pkg.scripts["visuals:check"]).toBeDefined();
  });

  it.skipIf(!existsSync(join(root, PREVIEW_PATH)))("preview html shows light and dark side by side", () => {
    const html = readFileSync(join(root, PREVIEW_PATH), "utf8");
    expect(html).toBe(previewHtml());
    expect(html.match(/data-figure=/g)?.length ?? 0).toBe(FIGURES.length);
    for (const f of ASSET_FILES) {
      expect(html, f).toContain(`src="../../assets/${f}"`);
      expect(existsSync(join(root, "assets", f)), f).toBe(true);
    }
    expect(/https?:/.test(html)).toBe(false);
    expect(html.includes("<script")).toBe(false);
    expect(html).toContain(`.dark{background:${THEMES.dark.bg}`);
  });

  it("stackBaselines centres content in a box", () => {
    expect(stackBaselines(0, 100, [{ lines: 1, fontSize: 10, lineHeight: 20, gapBefore: 0 }])).toEqual([53]);
    expect(
      stackBaselines(0, 100, [
        { lines: 1, fontSize: 10, lineHeight: 20, gapBefore: 0 },
        { lines: 2, fontSize: 10, lineHeight: 20, gapBefore: 10 },
      ]),
    ).toEqual([28, 58]);
  });

  it("life timeline birth guide stays out of text rows", () => {
    for (const f of ["life-timeline-light.svg", "life-timeline-dark.svg"]) {
      const lines = [...svgOf(f).matchAll(/<line\b[^>]*stroke-dasharray[^>]*>/g)].map((m) => m[0]);
      expect(lines.length, f).toBe(8);
      for (const line of lines) {
        const y1 = Number(/\sy1="([^"]+)"/.exec(line)?.[1]);
        const y2 = Number(/\sy2="([^"]+)"/.exec(line)?.[1]);
        expect(Math.abs(y2 - y1), `${f} ${line}`).toBeLessThanOrEqual(30);
      }
    }
  });
});
