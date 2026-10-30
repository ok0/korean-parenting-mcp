import { parseDate } from "../../src/date/civil-date.js";
import { computeOfflineTimeline, type OfflineTimeline } from "../../src/timeline/offline.js";
import type { TimelineArgs } from "../../src/timeline/input.js";

export const EXAMPLE = {
  due_date: "2027-03-15",
  reference_date: "2026-06-08",
  months_ahead: 84,
  include_past: true,
  fetus_count: 1,
} as const satisfies TimelineArgs;

export function exampleTimeline(args: TimelineArgs = EXAMPLE): OfflineTimeline {
  return computeOfflineTimeline({ ...args }, parseDate(args.reference_date as string));
}
