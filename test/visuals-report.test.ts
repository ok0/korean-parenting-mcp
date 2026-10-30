import { describe, expect, it } from "vitest";
import { allTools } from "../src/tools/registry.js";
import { buildAll } from "../scripts/visuals/generate.js";
import {
  FALLBACK_LINE,
  REPORT_DISCLAIMER,
  REPORT_EXAMPLE,
  REPORT_REQUEST,
  REQUEST_LABEL,
  SECTION_CAPS,
  SECTION_HEADINGS,
  WORKER_NOTE,
  buildReportModel,
  renderReport,
  reportTimeline,
} from "../scripts/visuals/report.js";
import { THEMES } from "../scripts/visuals/theme.js";
import { descText, flatText, isoDates, textElements } from "./helpers/visuals.js";

const t = reportTimeline();
const m = buildReportModel(t);
const out = `${t.output.body}\n${t.output.footer ?? ""}`;
const files = ["report-example-light.svg", "report-example-dark.svg"] as const;
const built = buildAll();

function svgOf(f: string): string {
  const svg = built[f];
  if (svg === undefined) throw new Error(`없음: ${f}`);
  return svg;
}

function rest(svg: string): string {
  let s = flatText(svg).split(REPORT_REQUEST).join("").split(WORKER_NOTE).join("");
  for (const fact of m.facts) s = s.split(fact).join("");
  return s;
}

describe("report example figure (M30b)", () => {
  it("input is fixed, keyless and after the data date", () => {
    expect(REPORT_REQUEST).toContain(REPORT_EXAMPLE.due_date);
    expect(REPORT_REQUEST).toContain(REPORT_EXAMPLE.region);
    expect(isoDates(REPORT_REQUEST)).toEqual([REPORT_EXAMPLE.due_date]);
    const latest = t.result.items.map((i) => i.provenance.as_of).reduce((a, b) => (b > a ? b : a), "");
    expect(REPORT_EXAMPLE.reference_date > latest).toBe(true);
    expect(m.tools).toEqual(["get_timeline"]);
    for (const name of m.tools) {
      const tool = allTools.find((x) => x.name === name);
      expect(tool, name).toBeDefined();
      expect(tool?.requiredKeys ?? [], name).toEqual([]);
    }
  });

  it("every value comes from the get_timeline output", () => {
    for (const fact of m.facts) expect(out, fact).toContain(fact);
    for (const f of files) {
      const v = flatText(svgOf(f));
      for (const re of [/\d{4}-\d{2}-\d{2}/g, /[\d.,]+만원/g, /\d+일/g]) {
        for (const tok of v.match(re) ?? []) expect(out, `${f} ${tok}`).toContain(tok);
      }
    }
    expect(out).toContain(m.dataAsOf);
    expect(m.facts.some((fact) => fact.includes("첫째"))).toBe(true);
  });

  it("five sections in order and required notices", () => {
    expect(m.sections.map((s) => s.heading)).toEqual([...SECTION_HEADINGS]);
    m.sections.forEach((s, k) => {
      expect(s.lines.length, s.heading).toBeLessThanOrEqual((SECTION_CAPS[k] ?? 0) + 1);
    });
    for (const f of files) {
      const svg = svgOf(f);
      const v = flatText(svg);
      const pos = SECTION_HEADINGS.map((h) => v.indexOf(h));
      expect(
        pos.every((p, i) => p >= 0 && (i === 0 || p > (pos[i - 1] ?? -1))),
        f,
      ).toBe(true);
      for (const w of [
        "예시",
        "개인 맞춤 아님",
        "비공식",
        "출처",
        "기준일",
        REPORT_DISCLAIMER,
        "AI 도우미",
        REQUEST_LABEL,
        "사용한 기능:",
        "(키 없이 동작)",
        `이번 달 = ${m.monthLabel}`,
      ]) {
        expect(v, `${f} ${w}`).toContain(w);
      }
      expect(/신청 필요|녹화/.test(v), f).toBe(false);
      const desc = descText(svg);
      expect(desc, f).toContain(REPORT_REQUEST);
      expect(desc, f).toContain("get_timeline");
      expect(svg, f).toContain('data-tool="get_timeline"');
    }
  });

  it("work status and birth order appear only where they belong", () => {
    for (const f of files) {
      const svg = svgOf(f);
      const v = flatText(svg);
      expect(v, f).toContain(REPORT_REQUEST);
      expect(v, f).toContain(WORKER_NOTE);
      const r = rest(svg);
      for (const w of ["직장인", "첫째", "아이사랑"]) expect(r.includes(w), `${f} ${w}`).toBe(false);
    }
  });

  it("empty result falls back on every section", () => {
    const empty = buildReportModel({ ...t, result: { ...t.result, items: [] }, local: { ...t.local, lines: [] } });
    expect(empty.sections).toHaveLength(SECTION_HEADINGS.length);
    for (const s of empty.sections) {
      expect(s.fallback, s.heading).toBe(true);
      expect(s.lines, s.heading).toEqual([FALLBACK_LINE]);
      expect(s.more, s.heading).toBe(0);
    }
  });

  it("this month depends on the report date", () => {
    const feb = buildReportModel(reportTimeline({ ...REPORT_EXAMPLE, reference_date: "2027-02-01" }));
    expect(feb.sections[0]?.lines).not.toEqual(m.sections[0]?.lines);
    expect(feb.monthLabel).toBe("2027년 2월");
  });

  it("text is at least 13px and overflow throws", () => {
    for (const f of files) {
      for (const e of textElements(svgOf(f))) {
        expect(e.fontSize, f).toBeGreaterThanOrEqual(13);
      }
    }
    const overflow = {
      ...m,
      sections: m.sections.map((s) => ({ ...s, lines: Array<string>(30).fill(s.lines[0] ?? FALLBACK_LINE) })),
    };
    expect(() => renderReport(overflow, THEMES.light)).toThrow(/종이 높이/);
  });
});
