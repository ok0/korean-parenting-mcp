import { z } from "zod";

export interface FieldDoc {
  purpose: string;
  format: string;
  example: string;
}

function assertFieldDoc(doc: FieldDoc): void {
  for (const key of ["purpose", "format", "example"] as const) {
    if (doc[key].trim() === "") {
      throw new Error(`FieldDoc 누락: ${key}`);
    }
  }
}

export function describeField(doc: FieldDoc): string {
  assertFieldDoc(doc);
  return `${doc.purpose} 형식: ${doc.format}. 예: ${doc.example}`;
}

export function dateField(doc: FieldDoc): z.ZodString {
  return z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 형식이어야 합니다")
    .describe(describeField(doc));
}

export function intField(doc: FieldDoc, range: { min: number; max: number }) {
  return z
    .union([
      z.number().int(),
      z.string().regex(/^\s*-?\d+\s*$/, "정수(숫자 또는 숫자 문자열)여야 합니다"),
    ])
    .transform((v) => Number(v))
    .pipe(z.number().int().min(range.min).max(range.max))
    .describe(describeField(doc));
}

export function boolField(doc: FieldDoc) {
  return z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((v) => v === true || v === "true")
    .describe(describeField(doc));
}

export function keywordField(doc: FieldDoc, len?: { min?: number; max?: number }) {
  return z
    .string()
    .trim()
    .min(len?.min ?? 1)
    .max(len?.max ?? 50)
    .describe(describeField(doc));
}

export function enumField<const T extends readonly [string, ...string[]]>(values: T, doc: FieldDoc) {
  return z.enum(values).describe(describeField(doc));
}
