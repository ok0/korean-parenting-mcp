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

const RuleId = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "id는 소문자·숫자·하이픈");

export const DeadlineEntrySchema = ProvenanceFields.extend({
  id: RuleId,
  title: z.string().min(1),
  rule: PeriodRuleSchema,
  notes: z.array(z.string().min(1)),
}).superRefine(requireVerifier);
export type DeadlineEntry = z.output<typeof DeadlineEntrySchema>;

export const DeadlinesSchema = z
  .object({ deadlines: z.array(DeadlineEntrySchema).min(1) })
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.deadlines.forEach((d, i) => {
      if (seen.has(d.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["deadlines", i, "id"],
          message: `중복 규칙 id: ${d.id}`,
        });
      }
      seen.add(d.id);
    });
  });
export type DeadlinesFile = z.output<typeof DeadlinesSchema>;

export const CheckupOffsetSchema = z.union([
  z.strictObject({ days: z.number().int().min(0).max(400) }),
  z.strictObject({ months: z.number().int().min(0).max(156) }),
]);
export type CheckupOffset = z.output<typeof CheckupOffsetSchema>;

export const CHECKUP_ROUNDS = { infant: 8, oral: 4 } as const;
export type CheckupProgram = keyof typeof CHECKUP_ROUNDS;

export const CheckupEntrySchema = ProvenanceFields.extend({
  id: RuleId,
  program: z.enum(["infant", "oral"]),
  round: z.number().int().min(1),
  from: CheckupOffsetSchema,
  to: CheckupOffsetSchema,
  notes: z.array(z.string().min(1)),
}).superRefine((v, ctx) => {
  requireVerifier(v, ctx);
  const fromIsDays = "days" in v.from;
  const toIsDays = "days" in v.to;
  if (fromIsDays !== toIsDays) {
    ctx.addIssue({
      code: "custom",
      path: ["to"],
      message: "from과 to의 단위(days/months)가 같아야 합니다",
    });
    return;
  }
  const fromValue = "days" in v.from ? v.from.days : v.from.months;
  const toValue = "days" in v.to ? v.to.days : v.to.months;
  if (toValue < fromValue) {
    ctx.addIssue({
      code: "custom",
      path: ["to"],
      message: "to가 from보다 작습니다",
    });
  }
});
export type CheckupEntry = z.output<typeof CheckupEntrySchema>;

export const CheckupsSchema = z
  .object({ checkups: z.array(CheckupEntrySchema) })
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.checkups.forEach((c, i) => {
      if (seen.has(c.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["checkups", i, "id"],
          message: `중복 규칙 id: ${c.id}`,
        });
      }
      seen.add(c.id);
    });
    for (const p of Object.keys(CHECKUP_ROUNDS) as CheckupProgram[]) {
      const total = CHECKUP_ROUNDS[p];
      const rounds = v.checkups
        .filter((c) => c.program === p)
        .map((c) => c.round)
        .sort((a, b) => a - b);
      const expected = Array.from({ length: total }, (_, k) => k + 1);
      const ok = rounds.length === expected.length && rounds.every((r, k) => r === expected[k]);
      if (!ok) {
        ctx.addIssue({
          code: "custom",
          path: ["checkups"],
          message: `${p} 회차 누락 또는 중복: 기대 1~${total}회, 실제 [${rounds.join(", ")}]`,
        });
      }
    }
  });
export type CheckupsFile = z.output<typeof CheckupsSchema>;

export const VaccineOffsetSchema = z.union([
  z.strictObject({ days: z.number().int().min(0).max(400) }),
  z.strictObject({ months: z.number().int().min(0).max(156) }),
  z.strictObject({ years: z.number().int().min(0).max(18) }),
]);
export type VaccineOffset = z.output<typeof VaccineOffsetSchema>;

function offsetUnit(o: VaccineOffset): "days" | "months" | "years" {
  if ("days" in o) return "days";
  if ("months" in o) return "months";
  return "years";
}

function offsetValue(o: VaccineOffset): number {
  if ("days" in o) return o.days;
  if ("months" in o) return o.months;
  return o.years;
}

export const VACCINE_CODES = [
  "bcg",
  "hepb",
  "dtap",
  "ipv",
  "hib",
  "pcv",
  "rota",
  "mmr",
  "var",
  "hepa",
  "je",
  "hpv",
  "flu",
] as const;
export type VaccineCode = (typeof VACCINE_CODES)[number];

export const VaccineDoseSchema = z
  .strictObject({
    dose: z.number().int().min(1),
    from: VaccineOffsetSchema,
    to: VaccineOffsetSchema,
    label: z.string().min(1).optional(),
    alias: z.string().min(1).optional(),
  })
  .superRefine((v, ctx) => {
    if (offsetUnit(v.from) !== offsetUnit(v.to)) {
      ctx.addIssue({
        code: "custom",
        path: ["to"],
        message: "from과 to의 단위(days/months/years)가 같아야 합니다",
      });
      return;
    }
    if (offsetValue(v.to) < offsetValue(v.from)) {
      ctx.addIssue({
        code: "custom",
        path: ["to"],
        message: "구간 시작이 끝보다 늦습니다(to < from)",
      });
    }
  });
export type VaccineDose = z.output<typeof VaccineDoseSchema>;

export const VaccineEntrySchema = ProvenanceFields.extend({
  id: RuleId,
  code: z.enum(VACCINE_CODES),
  name: z.string().min(1),
  doses: z.array(VaccineDoseSchema).min(1),
  notes: z.array(z.string().min(1)),
}).superRefine((v, ctx) => {
  requireVerifier(v, ctx);
  const doses = v.doses.map((d) => d.dose).sort((a, b) => a - b);
  const ok = doses.every((n, k) => n === k + 1);
  if (!ok) {
    ctx.addIssue({
      code: "custom",
      path: ["doses"],
      message: `${v.id} 차수 번호 불연속: [${doses.join(", ")}]`,
    });
  }
});
export type VaccineEntry = z.output<typeof VaccineEntrySchema>;

export const InfluenzaSeasonSchema = ProvenanceFields.extend({
  id: RuleId,
  label: z.string().min(1),
  start: IsoDate,
  end: IsoDate,
  child_from_months: z.number().int().min(0).max(24),
  child_max_age_years: z.number().int().min(1).max(18),
  two_dose_under_years: z.number().int().min(1).max(18),
  pregnant_doses: z.number().int().min(1).max(2),
  notes: z.array(z.string().min(1)),
}).superRefine((v, ctx) => {
  requireVerifier(v, ctx);
  if (v.end < v.start) {
    ctx.addIssue({
      code: "custom",
      path: ["end"],
      message: "절기 시작이 종료보다 늦습니다",
    });
  }
});
export type InfluenzaSeason = z.output<typeof InfluenzaSeasonSchema>;

export const VaccinationsSchema = z
  .object({
    vaccines: z.array(VaccineEntrySchema),
    influenza: z.object({
      seasons: z.array(InfluenzaSeasonSchema).min(1, "인플루엔자 절기가 1개 이상 필요합니다"),
    }),
  })
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    const checkId = (id: string, path: (string | number)[]): void => {
      if (seen.has(id)) {
        ctx.addIssue({ code: "custom", path, message: `중복 규칙 id: ${id}` });
      }
      seen.add(id);
    };
    v.vaccines.forEach((e, i) => checkId(e.id, ["vaccines", i, "id"]));
    v.influenza.seasons.forEach((s, i) => checkId(s.id, ["influenza", "seasons", i, "id"]));

    v.vaccines.forEach((e, i) => {
      if (e.code === "flu") {
        ctx.addIssue({
          code: "custom",
          path: ["vaccines", i, "code"],
          message: "인플루엔자는 influenza.seasons에 둡니다",
        });
      }
    });

    const present = new Set(v.vaccines.map((e) => e.code));
    const missing = VACCINE_CODES.filter((c) => c !== "flu" && !present.has(c));
    if (missing.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["vaccines"],
        message: `백신 13종 중 누락: ${missing.join(", ")}`,
      });
    }

    const seasons = v.influenza.seasons;
    for (let i = 1; i < seasons.length; i++) {
      const prev = seasons[i - 1];
      const next = seasons[i];
      if (prev && next && next.start <= prev.end) {
        ctx.addIssue({
          code: "custom",
          path: ["influenza", "seasons", i],
          message: "절기 순서 오류 또는 겹침",
        });
      }
    }
  });
export type VaccinationsFile = z.output<typeof VaccinationsSchema>;
