import type { TimelineRule } from "../types.js";
import { prenatalItems } from "./prenatal.js";
import { pregnancyInfluenzaItems } from "./vaccination.js";

export const pregnancyRule: TimelineRule = (input) => {
  if (input.mode !== "pregnant") return [];
  const due = input.dueDate ?? input.birthDate;
  return [...prenatalItems(due), ...pregnancyInfluenzaItems(due)];
};
