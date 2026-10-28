import { z } from "zod";
import { tryParseDate } from "../date/civil-date.js";
import { checkHolidaySanity } from "../date/holiday-sanity.js";

export const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 형식이어야 합니다")
  .refine((s) => tryParseDate(s) !== undefined, "존재하지 않는 날짜입니다");

export const VerifiedSchema = z.enum(["full", "partial", "false"]);

export const ProvenanceFields = z.object({
  basis_ids: z.array(z.string().min(1)).min(1, "근거 문서 id가 1개 이상 필요합니다"),
  as_of: IsoDate,
  verified: VerifiedSchema,
  verified_by: z.string().min(1).optional(),
  verified_on: IsoDate.optional(),
  note: z.string().optional(),
});

export function requireVerifier(
  v: { verified: string; verified_by?: string; verified_on?: string },
  ctx: z.RefinementCtx,
): void {
  if (v.verified === "full" && (!v.verified_by || !v.verified_on)) {
    ctx.addIssue({
      code: "custom",
      path: ["verified"],
      message: "verified가 full이면 verified_by와 verified_on이 필요합니다",
    });
  }
}

export const ProvenanceSchema = ProvenanceFields.superRefine(requireVerifier);

export type Provenance = z.output<typeof ProvenanceSchema>;

export const LawApiKeySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("admrul"),
    rule_id: z.string().nullable(),
    name: z.string().min(1),
    serial: z.string().optional(),
    number: z.string().optional(),
    issued: IsoDate.optional(),
  }),
  z.object({
    kind: z.literal("licbyl"),
    law_name: z.string().min(1),
    annex_no: z.string().min(1),
    promulgated: IsoDate.optional(),
    promulgation_no: z.string().optional(),
  }),
  z.object({
    kind: z.literal("law"),
    law_name: z.string().min(1),
    law_id: z.string().optional(),
    mst: z.string().regex(/^\d+$/).optional(),
    effective: IsoDate.optional(),
  }),
]);

export type LawApiKey = z.output<typeof LawApiKeySchema>;

export const BasisDocSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "id는 소문자·숫자·하이픈"),
    title: z.string().min(1),
    doc_no: z.string().min(1, "문서번호(doc_no)가 필요합니다"),
    kind: z.enum(["admrul", "licbyl", "law", "web"]),
    promulgated: IsoDate.optional(),
    amended: IsoDate.optional(),
    effective: IsoDate.optional(),
    url: z.url(),
    law_api: LawApiKeySchema.nullable(),
    as_of: IsoDate,
    verified: VerifiedSchema.optional(),
    note: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.promulgated && !v.amended && !v.effective) {
      ctx.addIssue({
        code: "custom",
        path: ["promulgated"],
        message: "공포·개정·시행일 중 하나 이상이 필요합니다",
      });
    }
  });

export type BasisDoc = z.output<typeof BasisDocSchema>;

export const BasisDocumentsSchema = z
  .object({ documents: z.array(BasisDocSchema).min(1) })
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.documents.forEach((doc, i) => {
      if (seen.has(doc.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["documents", i, "id"],
          message: `중복 근거 문서 id: ${doc.id}`,
        });
      }
      seen.add(doc.id);
    });
  });

export type BasisDocuments = z.output<typeof BasisDocumentsSchema>;

export const HolidayEntrySchema = z.object({ date: IsoDate, name: z.string().min(1) });

export const HolidaysSchema = ProvenanceFields.extend({
  source: z.enum(["manual-research", "kasi-api"]),
  generated_at: IsoDate,
  covers_years: z.array(z.number().int().min(2000).max(2100)),
  years: z.record(z.string().regex(/^\d{4}$/), z.array(HolidayEntrySchema)),
}).superRefine((v, ctx) => {
  requireVerifier(v, ctx);
  for (const [Y, list] of Object.entries(v.years)) {
    const seen = new Set<string>();
    list.forEach((entry, i) => {
      if (!entry.date.startsWith(`${Y}-`)) {
        ctx.addIssue({
          code: "custom",
          path: ["years", Y, i, "date"],
          message: "연도 키와 날짜의 연도가 다릅니다",
        });
      }
      if (seen.has(entry.date)) {
        ctx.addIssue({
          code: "custom",
          path: ["years", Y, i, "date"],
          message: `같은 연도 내 중복 날짜: ${entry.date}`,
        });
      }
      seen.add(entry.date);
    });
  }
  for (const y of v.covers_years) {
    const list = v.years[String(y)];
    if (!list) {
      ctx.addIssue({
        code: "custom",
        path: ["covers_years"],
        message: "covers_years에 있는 연도의 목록이 없습니다",
      });
      continue;
    }
    const check = checkHolidaySanity(y, list);
    if (!check.ok) {
      ctx.addIssue({
        code: "custom",
        path: ["covers_years"],
        message: `${y}년 건전성 검사 실패: ${check.missing.join(", ")} 누락`,
      });
    }
  }
});

export type HolidaysFile = z.output<typeof HolidaysSchema>;

export const PeriodRuleSchema = z.object({
  unit: z.enum(["day", "month"]),
  amount: z.number().int().min(1).max(1200),
  countFirstDay: z.boolean(),
  extendIfNonWorking: z.boolean(),
});
