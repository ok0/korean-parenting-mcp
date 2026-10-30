import type { TimelineArgs } from "../../src/timeline/input.js";

export interface FormValues { due: string; order: string; months: string; }

export function toTimelineArgs(v: FormValues): TimelineArgs {
  const args: TimelineArgs = {};
  const due = v.due.trim();
  if (due !== "") args.due_date = due;
  if (v.order !== "") args.birth_order = Number(v.order);
  if (v.months !== "") args.months_ahead = Number(v.months);
  return args;
}
