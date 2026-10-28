import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadData } from "../src/data-store/load.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const LOG = join(root, ".docs/verification-log.md");
const VERIFIER = "agent (ok0-editor) — needs human spot-check";
const RANK: Record<string, number> = { false: 0, partial: 1, full: 2 };
const ROW_HEADER = ["행", "데이터", "원문 이름", "원문 URL", "검색일", "페이지/절", "SHA-256", "저장값", "원문값", "대조 결과", "수정값(JSON)", "결과 상태", "사유", "verifier"];

type Section = { title: string; header: string[]; rows: string[][] };

function parseSections(text: string): Section[] {
  const out: Section[] = [];
  let cur: Section | null = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("## ")) {
      cur = { title: line.slice(3).trim(), header: [], rows: [] };
      out.push(cur);
      continue;
    }
    if (cur === null || !line.startsWith("|") || line.startsWith("|-")) continue;
    const cells = line.split("|").slice(1, -1).map((s) => s.trim());
    if (cur.header.length === 0) cur.header = cells;
    else cur.rows.push(cells);
  }
  return out;
}

function walkFull(value: unknown, file: string, out: Set<string>): void {
  if (Array.isArray(value)) {
    for (const v of value) walkFull(v, file, out);
    return;
  }
  if (value !== null && typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (o.verified === "full" && typeof o.id === "string") out.add(`${file}:${o.id}`);
    for (const v of Object.values(o)) walkFull(v, file, out);
  }
}

describe.skipIf(!existsSync(LOG))("verification log vs data (M17)", () => {
  const text = existsSync(LOG) ? readFileSync(LOG, "utf8") : "";
  const sections = parseSections(text);
  const section = (title: string): Section => {
    const s = sections.find((x) => x.title === title);
    if (s === undefined) throw new Error(`절 없음: ${title}`);
    return s;
  };
  const items = section("데이터 항목 대조");
  const ITEM_IDX = Object.fromEntries(ROW_HEADER.map((h, i) => [h, i]));
  const cell = (row: string[], col: string): string => row[ITEM_IDX[col] ?? -1] ?? "";
  const reviewDate = /대조일: (\d{4}-\d{2}-\d{2})/.exec(text)?.[1] ?? "";

  const statusByKey = (): Map<string, string[]> => {
    const m = new Map<string, string[]>();
    for (const r of items.rows) {
      const key = cell(r, "데이터");
      m.set(key, [...(m.get(key) ?? []), cell(r, "결과 상태")]);
    }
    return m;
  };
  const minStatus = (states: string[]): string =>
    states.reduce((a, b) => (RANK[a]! <= RANK[b]! ? a : b));

  const dataEntry = (key: string): { verified: string; verified_by?: string; verified_on?: string } | undefined => {
    const [file, id] = key.split(":") as [string, string];
    if (file === "prenatal") return loadData("prenatal");
    if (file === "checkups") return loadData("checkups").checkups.find((c) => c.id === id);
    const vacc = loadData("vaccinations");
    return vacc.vaccines.find((v) => v.id === id) ?? vacc.influenza.seasons.find((s) => s.id === id);
  };

  it("header and verifier", () => {
    expect(text).toMatch(/대조일: \d{4}-\d{2}-\d{2}/);
    expect(text).toContain(`verifier: ${VERIFIER}`);
    expect(items.header).toEqual(ROW_HEADER);
  });

  it("rows are well-formed", () => {
    for (const r of items.rows) {
      const id = cell(r, "행");
      expect(r.length, id).toBe(ROW_HEADER.length);
      expect(cell(r, "데이터"), id).toMatch(/^(checkups|prenatal|vaccinations):[a-z0-9-]+$/);
      expect(cell(r, "원문 URL"), id).toMatch(/^https:\/\//);
      expect(cell(r, "원문 URL"), id).not.toMatch(/[?&]oc=/i);
      expect(cell(r, "검색일"), id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(cell(r, "SHA-256"), id).toMatch(/^([0-9a-f]{64}|-)$/);
      expect(["일치", "수정", "미판독"], id).toContain(cell(r, "대조 결과"));
      expect(["full", "partial", "false"], id).toContain(cell(r, "결과 상태"));
      expect(cell(r, "verifier"), id).toBe(VERIFIER);
      if (cell(r, "결과 상태") !== "full") expect(cell(r, "사유"), id).not.toBe("-");
      if (cell(r, "대조 결과") === "미판독") expect(cell(r, "결과 상태"), id).not.toBe("full");
      if (cell(r, "대조 결과") === "수정") expect(() => JSON.parse(cell(r, "수정값(JSON)"))).not.toThrow();
    }
  });

  it("no item is missing", () => {
    const ids = new Set(items.rows.map((r) => cell(r, "행")));
    const need: string[] = [];
    for (const c of loadData("checkups").checkups) need.push(`R1-${c.program}-${c.round}`);
    need.push("R2-interval-1", "R2-interval-2", "R2-interval-3", "R2-high-risk");
    for (const v of loadData("vaccinations").vaccines) {
      for (const d of v.doses) need.push(`R3-${v.id}-${d.dose}`);
    }
    need.push("R3-rota-rv1-limit", "R3-rota-rv5-limit", "R3-hpv-target");
    for (const s of loadData("vaccinations").influenza.seasons) {
      for (const k of ["season", "child", "two-dose", "pregnant"]) need.push(`R3-${s.id}-${k}`);
    }
    for (const id of need) expect(ids, id).toContain(id);
  });

  it("log status equals data status", () => {
    for (const [key, states] of statusByKey()) {
      const entry = dataEntry(key);
      expect(entry, key).toBeDefined();
      const expectedStatus = minStatus(states);
      expect(entry?.verified, key).toBe(expectedStatus);
      if (expectedStatus === "full") {
        expect(entry?.verified_by, key).toBe(VERIFIER);
        expect(entry?.verified_on, key).toBe(reviewDate);
      }
    }
  });

  it("no full item outside the log", () => {
    const logFull = new Set([...statusByKey()].filter(([, s]) => minStatus(s) === "full").map(([k]) => k));
    const dataDir = join(root, "data");
    const full = new Set<string>();
    for (const f of readdirSync(dataDir).filter((n) => n.endsWith(".json"))) {
      const file = f.replace(/\.json$/, "");
      walkFull(JSON.parse(readFileSync(join(dataDir, f), "utf8")), file, full);
    }
    for (const key of full) expect(logFull.has(key), key).toBe(true);
    expect(
      [...full].filter((k) => k.startsWith("basis-documents:")),
    ).toEqual([]);
  });

  it("M11 section", () => {
    const m11 = section("M11 불일치 5건");
    expect(m11.rows.map((r) => r[0])).toEqual(["M11-1", "M11-2", "M11-3", "M11-4", "M11-5"]);
    for (const r of m11.rows) {
      expect(r[6], r[0]).toBeTruthy();
      expect(r[8], r[0]).toBeTruthy();
    }
  });

  it("summary and sign-off", () => {
    const start = text.indexOf("## 수정 요약");
    expect(start).toBeGreaterThanOrEqual(0);
    const next = text.indexOf("\n## ", start + 1);
    const summaryBody = text.slice(start, next === -1 ? undefined : next);
    const modified = items.rows.filter((r) => cell(r, "대조 결과") === "수정").length;
    if (modified === 0) expect(summaryBody).toContain("수정 없음, 전 항목 일치/미판독");
    expect(sections[sections.length - 1]?.title).toBe("사람 서명 대기(릴리스 전 수동 점검)");
  });
});
