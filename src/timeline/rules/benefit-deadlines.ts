import type { TimelineRule } from "../types.js";
import { deadlineItem, findDeadline } from "./common.js";

export const BENEFIT_DEADLINE_IDS = ["parent-allowance", "child-allowance"] as const;

export const benefitDeadlineRule: TimelineRule = (input) =>
  BENEFIT_DEADLINE_IDS.map((id) =>
    deadlineItem(input, findDeadline(id), { category: "신청", nature: "지원 신청" }),
  );
