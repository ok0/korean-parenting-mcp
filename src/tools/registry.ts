import type { z } from "zod";
import type { KeyName } from "../core/config.js";
import type { ToolContext } from "../core/context.js";
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
  maxChars?: number;
  handler(args: z.output<S>, ctx: ToolContext): Promise<ToolOutput>;
}

export function defineTool<S extends z.ZodObject>(def: ToolDef<S>): ToolDef {
  return def as unknown as ToolDef;
}

export const allTools: readonly ToolDef[] = [];
