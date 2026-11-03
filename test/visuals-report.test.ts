import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { allTools } from "../src/tools/registry.js";
import { buildAll, diffAssets } from "../scripts/visuals/generate.js";
import {
  MORE_LINE,
  QUESTION_LABEL,
  REALTIME_FORBIDDEN,
  REPORT_BADGE,
  REPORT_DISCLAIMER,
  REPORT_FEATURE_TOOLS,
  REPORT_MAX_HEIGHT,
  REPORT_SECTIONS,
  SEP,
  buildReportModel,
  renderReport,
  usedFeaturesLine,
  type ReportLine,
} from "../scripts/visuals/report.js";
import {
  ANSWER_FILE,
  QUESTION_FILE,
  answerSection,
  loadReportSource,
  normalizeAnswer,
  parseReportSource,
  reportSourceDir,
} from "../scripts/visuals/report-source.js";
import { REPORT_FIGURE_ALT } from "../scripts/visuals/readme-figures.js";
import { THEMES } from "../scripts/visuals/theme.js";
import { SOURCE_NOTICE } from "../src/core/notice.js";
import { CLIENT_BRANDS, descText, flatText, textElements } from "./helpers/visuals.js";
import { matchedPatterns } from "./helpers/wording.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const dir = reportSourceDir();
const rawQ = readFileSync(join(dir, QUESTION_FILE), "utf8");
const rawA = readFileSync(join(dir, ANSWER_FILE), "utf8");
const src = loadReportSource();
const norm = normalizeAnswer(src.answer);
const m = buildReportModel(src);
const files = ["report-example-light.svg", "report-example-dark.svg"] as const;
const built = await buildAll();
const ENV_NAMES = ["DATA_GO_KR_SERVICE_KEY", "KINDERGARTEN_API_KEY", "LAW_OC", "SAFETYKOREA_AUTH_KEY"] as const;
const BANNED = ["녹", "화"].join("");
const PHONE = [/0\d{1,2}-\d{3,4}-\d{4}/, /\b1[5-9]\d{2}-\d{4}\b/];
const ROAD = /[가-힣]+\d*(?:로|길)(?:\d+길)?\s\d+(?:-\d+)?(?=[\s,|)]|$)/m;

function svgOf(f: string): string {
  const svg = built[f];
  if (svg === undefined) throw new Error(`없음: ${f}`);
  return svg;
}

function at<T>(arr: readonly T[], i: number): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`없음: ${i}`);
  return v;
}

function tsFiles(path: string): string[] {
  return readdirSync(path).flatMap((e) => {
    const p = join(path, e);
    if (statSync(p).isDirectory()) return tsFiles(p);
    return e.endsWith(".ts") ? [p] : [];
  });
}

describe("report example figure from a real answer (M30c)", () => {
  it("source folder holds only the two sanitized files and the replay modules are gone", () => {
    expect(readdirSync(dir).sort()).toEqual([ANSWER_FILE, QUESTION_FILE]);
    expect(existsSync(join(root, "scripts/visuals/replay.ts"))).toBe(false);
    expect(existsSync(join(root, "scripts/visuals/report-keyed.ts"))).toBe(false);
    const importRe = /from\s+["'][^"']*\/(?:replay|report-keyed)\.js["']/;
    for (const p of [...tsFiles(join(root, "scripts")), ...tsFiles(join(root, "test"))]) {
      expect(importRe.test(readFileSync(p, "utf8")), p).toBe(false);
    }
  });

  it("generation uses no network, env keys or wall clock", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("network");
    });
    const saved = ENV_NAMES.map((k) => [k, process.env[k]] as const);
    try {
      for (const k of ENV_NAMES) process.env[k] = "x".repeat(32);
      vi.useFakeTimers({ now: new Date("2031-01-01T00:00:00Z") });
      expect(await buildAll()).toEqual(built);
      for (const k of ENV_NAMES) delete process.env[k];
      expect(await buildAll()).toEqual(built);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      for (const [k, v] of saved) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      spy.mockRestore();
    }
  });

  it("answer date comes from the file head", () => {
    expect(src.answeredOn).toBe("2026-10-31");
    const that = parseReportSource(rawQ, rawA.replace("2026-10-31 -->", "2026-11-05 -->"));
    expect(flatText(renderReport(buildReportModel(that), THEMES.light))).toContain(
      "2026-11-05에 한 AI 앱에서 실제로 받은 답변",
    );
    expect(() => parseReportSource(rawQ, rawA.split("\n").slice(1).join("\n"))).toThrow(/받은 날짜/);
  });

  it("privacy: no handle, contacts, street addresses or links", () => {
    expect(ROAD.test("독서당로 218")).toBe(true);
    expect(ROAD.test("마장로29길 29")).toBe(true);
    expect(ROAD.test("왕십리광장로 17, ")).toBe(true);
    expect(ROAD.test("목표로 2029년")).toBe(false);
    expect(PHONE[0]?.test("02-2297-1755")).toBe(true);
    const texts = [rawQ, rawA, svgOf(files[0]), svgOf(files[1]), REPORT_FIGURE_ALT];
    for (const text of texts) {
      expect(text).not.toContain("ok0");
      expect(text).not.toMatch(/@[A-Za-z0-9_]/);
      expect(text).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
      expect(text).not.toMatch(/\/Users\/|\/home\/|[A-Za-z]:\\/);
      for (const re of PHONE) expect(re.test(text), re.source).toBe(false);
      expect(ROAD.test(text)).toBe(false);
      expect(text).not.toMatch(/\d+층/);
      expect(text).not.toMatch(/민자역사|나래타워|금호자이/);
      expect(text).not.toContain("Oct 31");
    }
    for (const text of [rawQ, rawA]) expect(text).not.toMatch(/https?:\/\/|www\./);
  });

  it("question bubble shows the real question verbatim", () => {
    for (const f of files) {
      const v = flatText(svgOf(f));
      expect(v.split("\n"), f).toContain(src.question.replace(/\s+/g, " "));
      expect(v, f).toContain(QUESTION_LABEL);
      expect(v, f).toContain("AI 도우미");
    }
  });

  it("six sections in order, each from the answer", () => {
    expect(REPORT_SECTIONS.map((s) => s.heading)).toEqual([
      "요약·할 일",
      "타임라인 핵심",
      "맞벌이 휴가·휴직",
      "지원금·혜택",
      "성동구 휴일 소아 진료",
      "어린이집·유치원",
    ]);
    for (const s of REPORT_SECTIONS) expect(() => answerSection(norm, s.answerHeading), s.heading).not.toThrow();
    for (const f of files) {
      const v = flatText(svgOf(f));
      const pos = REPORT_SECTIONS.map((s) => v.indexOf(s.heading));
      expect(
        pos.every((p, i) => p >= 0 && (i === 0 || p > (pos[i - 1] ?? -1))),
        f,
      ).toBe(true);
    }
  });

  it("every figure fact comes from the sanitized answer", () => {
    m.sections.forEach((sec, k) => {
      const spec = at(REPORT_SECTIONS, k);
      const body = answerSection(norm, spec.answerHeading);
      for (const line of sec.lines) {
        if (line.kind === "more") continue;
        for (const seg of line.text.split(SEP)) expect(body, `${sec.heading} ${seg}`).toContain(seg);
      }
    });
    expect(m.sections.map((sec) => sec.lines.filter((l) => l.kind === "more").map((l) => l.text))).toEqual([
      [],
      [MORE_LINE(6)],
      [],
      [MORE_LINE(3)],
      [],
      [MORE_LINE(3)],
    ]);
    const datePatterns = [/\d{4}-\d{2}-\d{2}/g, /[\d,.]+만원/g, /\d{2}:\d{2}~\d{2}:\d{2}/g, /\d+ \/ \d+/g, /\d+(?:일|주|개월|세|회|건|곳|차)/g, /\d+%/g];
    for (const f of files) {
      const v = flatText(svgOf(f)).replace(/외 \d+건 더 있어요/g, "");
      for (const re of datePatterns) {
        for (const tok of v.match(re) ?? []) expect(norm, `${f} ${tok}`).toContain(tok);
      }
    }
    expect(() => buildReportModel(src, [{ ...at(REPORT_SECTIONS, 0), items: [["11월", "지어낸 내용"]] }])).toThrow(
      /정리본에 없는 내용/,
    );
    expect(() => buildReportModel(src, [{ ...at(REPORT_SECTIONS, 0), answerHeading: "없는 구획" }])).toThrow(
      /정리본에 없는 구획/,
    );
  });

  it("pediatric and kindergarten sections show names, kinds, hours and seats only", () => {
    const pediatric = at(m.sections, 4);
    const kinder = at(m.sections, 5);
    for (const sec of [pediatric, kinder]) {
      for (const line of sec.lines.filter((l: ReportLine) => l.kind === "item" || l.kind === "header")) {
        if (line.kind === "item") expect(line.text.split(SEP), sec.heading).toHaveLength(3);
        expect(line.text, sec.heading).not.toMatch(PHONE[0] ?? /$^/);
        expect(line.text, sec.heading).not.toMatch(PHONE[1] ?? /$^/);
        expect(ROAD.test(line.text), sec.heading).toBe(false);
        expect(line.text, sec.heading).not.toMatch(/주소|전화|위치/);
      }
    }
    expect(at(REPORT_SECTIONS, 5).tableHeader).toEqual(["유치원", "설립", "만3세 정원/현원"]);
    for (const f of files) expect(matchedPatterns(flatText(svgOf(f)), REALTIME_FORBIDDEN), f).toEqual([]);
  });

  it("honest notices, used features and client neutrality", () => {
    for (const f of files) {
      const svg = svgOf(f);
      const v = flatText(svg);
      for (const w of [
        "2026-10-31",
        "실제로 받은 답변",
        "앱·질문·날짜에 따라 답변이 달라질 수 있어요",
        "줄여서 한 장으로 구성했어요",
        REPORT_BADGE,
        SOURCE_NOTICE,
        REPORT_DISCLAIMER,
        "법률 해석이 아닌 참고 정보",
        "응급실",
        usedFeaturesLine(),
      ]) {
        expect(v, `${f} ${w}`).toContain(w);
      }
      expect(v, f).not.toContain("비공식");
      expect((v.match(/출처:/g) ?? []).length, f).toBeGreaterThanOrEqual(6);
      expect(v, f).not.toContain("키 없이");
      for (const name of ENV_NAMES) expect(v, `${f} ${name}`).not.toContain(name);
      for (const id of REPORT_FEATURE_TOOLS) expect(v, `${f} ${id}`).not.toContain(id);
      const desc = descText(svg);
      expect(desc, f).toContain(src.question);
      expect(desc, f).toContain("실제 답변");
      expect(matchedPatterns(v, CLIENT_BRANDS), f).toEqual([]);
      expect(matchedPatterns(desc, CLIENT_BRANDS), f).toEqual([]);
    }
    expect(REPORT_BADGE).toBe("실제 답변 예시 · 한 가정의 질문에 맞춘 답변");
    for (const id of ["find_benefits", "find_night_pediatric", "find_kindergarten"]) {
      const tool = allTools.find((x) => x.name === id);
      expect(tool?.requiredKeys?.length ?? 0, id).toBeGreaterThan(0);
    }
    expect(allTools.find((x) => x.name === "get_timeline")?.requiredKeys?.length ?? 0).toBe(0);
    expect(matchedPatterns(REPORT_FIGURE_ALT, CLIENT_BRANDS)).toEqual([]);
    expect(REPORT_FIGURE_ALT).toContain("실제 답변");
  });

  it("text is at least 13px, height is capped and overflow throws", () => {
    for (const f of files) {
      const svg = svgOf(f);
      for (const e of textElements(svg)) expect(e.fontSize, f).toBeGreaterThanOrEqual(13);
      expect(Number(/height="(\d+)"/.exec(svg)?.[1])).toBeLessThanOrEqual(REPORT_MAX_HEIGHT);
    }
    const overflow = {
      ...m,
      sections: m.sections.map((s) => ({ ...s, lines: s.lines.slice(0, 1).flatMap((l) => Array<ReportLine>(40).fill(l)) })),
    };
    expect(() => renderReport(overflow, THEMES.light)).toThrow(/최대 높이/);
  });

  it("a changed sanitized answer marks only the report figure", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "kpm-real-"));
    try {
      cpSync(dir, tmp, { recursive: true });
      const answerPath = join(tmp, ANSWER_FILE);
      writeFileSync(answerPath, readFileSync(answerPath, "utf8").replace("꼭 확인하세요.", "꼭 확인해 주세요."));
      expect(await diffAssets(join(root, "assets"), { sourceDir: tmp })).toEqual([
        "report-example-dark.svg",
        "report-example-light.svg",
      ]);
      writeFileSync(answerPath, readFileSync(answerPath, "utf8").replace("09:00\\~24:00", "09:00\\~23:00"));
      await expect(buildAll({ sourceDir: tmp })).rejects.toThrow(/정리본에 없는 내용/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("files touched by this milestone avoid the banned word", () => {
    const paths = [
      "scripts/visuals/report.ts",
      "scripts/visuals/report-source.ts",
      "scripts/visuals/generate.ts",
      "scripts/visuals/readme-figures.ts",
      "scripts/visuals/tool-map.ts",
      "scripts/visuals/life-timeline.ts",
      "scripts/visuals/stories.ts",
      "scripts/visuals/labels.ts",
      "test/fixtures/visuals/real-question.md",
      "test/fixtures/visuals/real-answer.md",
      "README.md",
      "site/index.html",
      "assets/report-example-light.svg",
      "assets/report-example-dark.svg",
      "assets/tool-map-light.svg",
      "assets/tool-map-dark.svg",
      "assets/life-timeline-light.svg",
      "assets/life-timeline-dark.svg",
      "assets/question-stories-light.svg",
      "assets/question-stories-dark.svg",
      ".github/workflows/visuals-refresh.yml",
      "test/visuals-report.test.ts",
      "test/visuals.test.ts",
      "test/helpers/visuals.ts",
      "test/root-docs.test.ts",
      "test/site-page.test.ts",
      "test/client-neutral.test.ts",
      "test/workflows.test.ts",
      "test/visuals-refresh.test.ts",
    ];
    for (const rel of paths) {
      const p = join(root, rel);
      if (!existsSync(p)) continue;
      expect(readFileSync(p, "utf8"), rel).not.toContain(BANNED);
    }
  });
});
