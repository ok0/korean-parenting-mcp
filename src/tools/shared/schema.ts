import { z } from "zod";
import { tryParseDate } from "../../date/civil-date.js";

const DATE_SHAPE = /^\s*(?:\d{4}-\d{2}-\d{2}|\d{4}\.\d{2}\.\d{2}|\d{8})\s*$/;

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
    .string({ error: `날짜 문자열이 필요합니다(예: ${doc.example})` })
    .superRefine((s, ctx) => {
      if (!DATE_SHAPE.test(s)) {
        ctx.addIssue({ code: "custom", message: `YYYY-MM-DD, YYYY.MM.DD, YYYYMMDD 중 하나의 형식이어야 합니다(예: ${doc.example})` });
      } else if (tryParseDate(s) === undefined) {
        ctx.addIssue({ code: "custom", message: `존재하지 않는 날짜입니다(예: ${doc.example})` });
      }
    })
    .describe(describeField(doc));
}

export function intField(doc: FieldDoc, range: { min: number; max: number }) {
  const msg = `${range.min}~${range.max} 사이 정수여야 합니다(예: ${doc.example})`;
  return z
    .union(
      [
        z.number().int(),
        z.string().regex(/^\s*-?\d+\s*$/),
      ],
      { error: `정수(숫자 또는 숫자 문자열)여야 합니다(예: ${doc.example})` },
    )
    .transform((v) => Number(v))
    .pipe(z.number().int().min(range.min, msg).max(range.max, msg))
    .describe(describeField(doc));
}

export function boolField(doc: FieldDoc) {
  return z
    .union([z.boolean(), z.enum(["true", "false"])], {
      error: `true 또는 false여야 합니다(예: ${doc.example})`,
    })
    .transform((v) => v === true || v === "true")
    .describe(describeField(doc));
}

export function keywordField(doc: FieldDoc, len?: { min?: number; max?: number }) {
  return z
    .string()
    .trim()
    .min(len?.min ?? 1, { message: `${len?.min ?? 1}~${len?.max ?? 50}자여야 합니다(예: ${doc.example})` })
    .max(len?.max ?? 50, { message: `${len?.min ?? 1}~${len?.max ?? 50}자여야 합니다(예: ${doc.example})` })
    .describe(describeField(doc));
}

export function enumField<const T extends readonly [string, ...string[]]>(values: T, doc: FieldDoc) {
  return z.enum(values).describe(describeField(doc));
}

export const REGION_FIELD_DOC: FieldDoc = {
  purpose: "조회할 지역(시군구 단위, 동 단위 불가).",
  format: "시도·시군구 이름 1~40자, 시도 생략 가능",
  example: "성동구, 수원시 영통구",
};

export function regionField(doc: FieldDoc = REGION_FIELD_DOC) {
  return keywordField(doc, { max: 40 });
}
