import { loadData, resolveBasis } from "../data-store/load.js";
import type { CivilDate } from "../date/civil-date.js";
import { bundledCalendar, holidaySourceLabel, trackCalendarYears } from "../date/holiday-calendar.js";
import { keylessStatus } from "../provenance/revision-text.js";
import type { ToolOutput } from "../tools/registry.js";
import { buildTimeline } from "./engine.js";
import { resolveTimelineInput, type TimelineArgs } from "./input.js";
import { footerBasisIds, renderTimeline, type TimelineView } from "./render.js";
import { localGuidance } from "./rules/local.js";
import type { LocalGuidanceSection, TimelineResult } from "./types.js";

export interface OfflineTimeline {
  result: TimelineResult;
  local: LocalGuidanceSection;
  view: TimelineView;
  output: ToolOutput;
}

export function computeOfflineTimeline(args: TimelineArgs, today: CivilDate): OfflineTimeline {
  const input = resolveTimelineInput(args, today);
  const local = localGuidance({ mode: input.mode, region: input.region });
  const calendar = bundledCalendar({ referenceDate: input.referenceDate });
  const tracked = trackCalendarYears(calendar);
  const result = buildTimeline({ ...input, holidays: tracked.calendar });
  const revisions = resolveBasis(footerBasisIds(result, local)).map(keylessStatus);
  const view: TimelineView = {
    mode: input.mode,
    birthDate: input.birthDate,
    referenceDate: input.referenceDate,
    monthsAhead: input.monthsAhead,
    includePast: input.includePast,
    holidaySource: holidaySourceLabel({ ...calendar, requestedYears: tracked.years() }, loadData("holidays").generated_at),
  };
  return { result, local, view, output: renderTimeline(result, view, local, revisions) };
}
