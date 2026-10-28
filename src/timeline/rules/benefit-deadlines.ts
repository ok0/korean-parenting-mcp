import type { TimelineRule } from "../types.js";
import { deadlineItem, findDeadline } from "./common.js";
import { childAllowanceMemo, parentAllowanceMemo } from "./benefits.js";

export const BENEFIT_DEADLINE_IDS = ["parent-allowance", "child-allowance"] as const;

export const benefitDeadlineRule: TimelineRule = (input) =>
  BENEFIT_DEADLINE_IDS.map((id) => {
    const item = deadlineItem(input, findDeadline(id), { category: "신청", nature: "지원 신청" });
    const memo = id === "parent-allowance" ? parentAllowanceMemo(input) : childAllowanceMemo(input);
    return { ...item, notes: [...item.notes, memo] };
  });
