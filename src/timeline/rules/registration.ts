import type { TimelineRule } from "../types.js";
import { deadlineItem, findDeadline } from "./common.js";

export const registrationRule: TimelineRule = (input) => [
  deadlineItem(input, findDeadline("birth-registration"), { category: "신고", nature: "법정 의무" }),
];
