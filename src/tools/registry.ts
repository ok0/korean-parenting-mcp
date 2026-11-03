import type { z } from "zod";
import type { KeyName } from "../core/config.js";
import type { ToolContext } from "../core/context.js";
import { checkPregnancyDrugTool } from "./check-pregnancy-drug.js";
import { checkRecallTool } from "./check-recall.js";
import { findBenefitsTool } from "./find-benefits.js";
import { findCheckupClinicTool } from "./find-checkup-clinic.js";
import { findDaycareTool } from "./find-daycare.js";
import { findKindergartenTool } from "./find-kindergarten.js";
import { findLocalSupportTool } from "./find-local-support.js";
import { findNightPediatricTool } from "./find-night-pediatric.js";
import { findVaccinationClinicTool } from "./find-vaccination-clinic.js";
import { getLeaveArticleTool } from "./get-leave-article.js";
import { getTimelineTool } from "./get-timeline.js";
export type { KeyName } from "../core/config.js";

export interface ToolOutput {
  body: string;
  footer?: string;
}

export interface ToolDef<S extends z.ZodObject = z.ZodObject> {
  name: string;
  title: string;
  description: string;
  schema: S;
  annotations: { readOnlyHint: true; idempotentHint: boolean; openWorldHint: boolean };
  requiredKeys?: KeyName[];
  keyActions?: readonly string[]; // (M61) MISSING_KEY 조치 끝에 덧붙이는 도구별 안내
  maxChars?: number;
  handler(args: z.output<S>, ctx: ToolContext): Promise<ToolOutput>;
}

export function defineTool<S extends z.ZodObject>(def: ToolDef<S>): ToolDef {
  return def as unknown as ToolDef;
}

export const allTools: readonly ToolDef[] = [
  getTimelineTool,
  getLeaveArticleTool,
  findNightPediatricTool,
  findBenefitsTool,
  checkPregnancyDrugTool,
  checkRecallTool,
  findDaycareTool,
  findVaccinationClinicTool,
  findCheckupClinicTool,
  findKindergartenTool,
  findLocalSupportTool,
];
