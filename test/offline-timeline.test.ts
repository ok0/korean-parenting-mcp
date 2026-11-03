import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ToolError } from "../src/core/errors.js";
import * as load from "../src/data-store/load.js";
import { collectBasisIds, DataValidationError, makeDataStore } from "../src/data-store/validate.js";
import * as revisionCheck from "../src/provenance/revision-check.js";
import { getTimelineTool } from "../src/tools/get-timeline.js";
import type { TimelineArgs } from "../src/timeline/input.js";
import { computeOfflineTimeline } from "../src/timeline/offline.js";
import { createTestContext } from "./helpers/context.js";
import { pickRegion } from "./helpers/health-center-picks.js";

const TODAY = { y: 2026, m: 1, d: 1 };

const FOUND = pickRegion((l) => l.kind === "found")?.text ?? "";

const online = (args: TimelineArgs) => getTimelineTool.handler(args as never, createTestContext());

const readData = (name: string): unknown => JSON.parse(readFileSync(new URL(`../data/${name}.json`, import.meta.url), "utf8"));

const SAMPLES: TimelineArgs[] = [
  { due_date: "2027-01-31", reference_date: "2026-06-30" },
  { due_date: "2028-02-29", reference_date: "2027-06-01" },
  { due_date: "2026-09-25", reference_date: "2026-01-01", include_past: true },
  { due_date: "2026-10-28" },
  { due_date: "2026-01-01", reference_date: "2026-04-01", include_past: true },
  { due_date: "2027-02-10", reference_date: "2026-10-28", birth_order: 2, fetus_count: 2, region: "성동구", months_ahead: 36 },
  { due_date: "2027-02-10", reference_date: "2026-10-28", birth_order: 1, fetus_count: 1, region: "성동구" },
  { birth_date: "2026-05-28", reference_date: "2026-10-28" },
  { birth_date: "2025-12-31", reference_date: "2026-03-15", months_ahead: 24, include_past: true, region: "성동구", birth_order: 3 },
  { birth_date: "2026-01-31", reference_date: "2026-02-01", fetus_count: 2 },
  { birth_date: "2026-05-28", reference_date: "2026-10-28", region: FOUND },
  { due_date: "2027-02-10", reference_date: "2026-10-28", region: "경기도" },
];

const INVALID: TimelineArgs[] = [
  { due_date: "2027-02-10", birth_date: "2026-01-31", reference_date: "2026-10-28" },
  { reference_date: "2026-10-28" },
  { due_date: "2026-10-29", reference_date: "2026-01-01" },
  { birth_date: "2026-03-01", reference_date: "2026-02-01" },
];

describe("offline timeline", () => {
  it("matches keyless get_timeline output for 12 samples", async () => {
    expect(FOUND).not.toBe("");
    expect(SAMPLES).toHaveLength(12);
    for (const s of SAMPLES) {
      const on = await online(s);
      const off = computeOfflineTimeline(s, TODAY);
      expect(off).not.toBeInstanceOf(Promise);
      expect(off.output.body).toBe(on.body);
      expect(off.output.footer).toBe(on.footer);
      expect(off.output.footer).toMatch(/자동 확인 대상 외|법제처 OC 미설정: 개정 여부 확인 생략/);
    }
    expect(computeOfflineTimeline(SAMPLES[10]!, TODAY).output.footer).toContain("[health-center-standard-data]");
    expect(computeOfflineTimeline(SAMPLES[11]!, TODAY).output.footer).not.toContain("[health-center-standard-data]");
  });

  it("throws the same ToolError for invalid input", async () => {
    expect(INVALID).toHaveLength(4);
    for (const s of INVALID) {
      let onErr: unknown;
      let offErr: unknown;
      try {
        await online(s);
      } catch (e) {
        onErr = e;
      }
      try {
        computeOfflineTimeline(s, TODAY);
      } catch (e) {
        offErr = e;
      }
      expect(onErr).toBeInstanceOf(ToolError);
      expect(offErr).toBeInstanceOf(ToolError);
      const a = onErr as ToolError;
      const b = offErr as ToolError;
      expect(b.kind).toBe(a.kind);
      expect(b.kind).toBe("BAD_INPUT");
      expect(b.message).toBe(a.message);
      expect(b.actions).toEqual(a.actions);
    }
  });

  it("keeps legacy export names", () => {
    for (const name of ["DataValidationError", "collectBasisIds", "validateDataset", "findDataDir", "readDataset", "loadData", "resolveBasis"]) {
      expect(typeof (load as Record<string, unknown>)[name]).toBe("function");
    }
    for (const name of [
      "REVISION_TEXT",
      "UNAVAILABLE_TEXT",
      "storedFields",
      "compareKey",
      "checkRevisionDocs",
      "ISSUE_MARKER",
      "kstStamp",
      "buildIssueBody",
      "checkRevisions",
      "skippedStatus",
    ]) {
      expect((revisionCheck as Record<string, unknown>)[name]).not.toBeUndefined();
    }
  });

  it("makeDataStore memoizes and checks basis references", () => {
    const recorded: string[] = [];
    const store = makeDataStore((name) => {
      recorded.push(name);
      return readData(name);
    });
    const first = store.loadData("holidays");
    store.loadData("holidays");
    expect(recorded).toEqual(["basis-documents", "holidays"]);
    expect(first).toEqual(load.loadData("holidays"));
    expect(() => store.resolveBasis(["nope"])).toThrow("알 수 없는 근거 문서 id: nope");

    const deadlinesRaw = readData("deadlines");
    const droppedId = collectBasisIds(deadlinesRaw)[0] as string;
    const basisRaw = readData("basis-documents") as { documents: { id: string }[] };
    const broken = makeDataStore((name) => {
      if (name === "basis-documents") {
        return { ...basisRaw, documents: basisRaw.documents.filter((d) => d.id !== droppedId) };
      }
      return readData(name);
    });
    let caught: unknown;
    try {
      broken.loadData("deadlines");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(DataValidationError);
    expect((caught as DataValidationError).dataset).toBe("deadlines");
  });
});
