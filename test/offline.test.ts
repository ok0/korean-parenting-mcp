import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { formatDate, parseDate, todayKst } from "../src/date/civil-date.js";
import { applyOffset } from "../src/date/offsets.js";
import { bundledCalendar } from "../src/date/holiday-calendar.js";
import { checkHolidaySanity } from "../src/date/holiday-sanity.js";
import { computeDeadline } from "../src/date/legal-period.js";
import { loadData } from "../src/data-store/load.js";
import { buildTimeline } from "../src/timeline/engine.js";

const fetchStub = vi.fn(() => {
  throw new Error("network disabled");
});

beforeAll(() => {
  vi.stubGlobal("fetch", fetchStub);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".ts"))
    .map((e) => join(dir, e.name));
}

describe("offline date and data modules", () => {
  it("runs without network access", () => {
    loadData("basis-documents");
    loadData("holidays");
    bundledCalendar({ years: [2026, 2027, 2028], referenceDate: parseDate("2027-06-01") });
    const deadline = computeDeadline(
      parseDate("2026-08-25"),
      { unit: "month", amount: 1, countFirstDay: true, extendIfNonWorking: true },
      bundledCalendar(),
    );
    expect(formatDate(deadline.end)).toBe("2026-09-28");
    checkHolidaySanity(2027, loadData("holidays").years["2027"] ?? []);
    applyOffset(parseDate("2026-05-10"), { days: 14 });
    todayKst({ now: () => new Date("2026-12-31T16:00:00Z") });
    buildTimeline({
      birthDate: parseDate("2026-01-31"),
      referenceDate: parseDate("2026-02-01"),
      monthsAhead: 156,
      includePast: true,
      holidays: bundledCalendar(),
    });
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("source modules contain no network references", () => {
    const dirs = [
      fileURLToPath(new URL("../src/date", import.meta.url)),
      fileURLToPath(new URL("../src/data-store", import.meta.url)),
      fileURLToPath(new URL("../src/timeline", import.meta.url)),
      fileURLToPath(new URL("../src/timeline/rules", import.meta.url)),
      fileURLToPath(new URL("../src/tools/shared", import.meta.url)),
    ];
    const files = [fileURLToPath(new URL("../src/tools/get-timeline.ts", import.meta.url))];
    const forbidden = ["fetch", "http:", "node:http", "node:https"];
    for (const dir of dirs) {
      files.push(...tsFiles(dir));
    }
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const token of forbidden) {
        expect(text, file).not.toContain(token);
      }
    }
  });
});
