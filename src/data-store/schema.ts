import { z } from "zod";
import { addDays, formatDate, parseDate, tryParseDate } from "../date/civil-date.js";
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
    verified_by: z.string().min(1).optional(),
    verified_on: IsoDate.optional(),
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
    if (v.verified !== undefined) requireVerifier({ verified: v.verified, verified_by: v.verified_by, verified_on: v.verified_on }, ctx);
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

export const PrenatalIntervalSchema = z.strictObject({
  from_week: z.number().int().min(0).max(42),
  to_week: z.number().int().min(0).max(42).nullable(),
  every_weeks: z.number().int().min(1).max(4),
});
export type PrenatalInterval = z.output<typeof PrenatalIntervalSchema>;

export const PRENATAL_INTERVAL_COUNT = 3;

export const PrenatalSchema = ProvenanceFields.extend({
  intervals: z.array(PrenatalIntervalSchema),
  high_risk_note: z.string().min(1),
  notes: z.array(z.string().min(1)),
}).superRefine((v, ctx) => {
  requireVerifier(v, ctx);
  const iv = v.intervals;
  const fail = (message: string): void => {
    ctx.addIssue({ code: "custom", path: ["intervals"], message });
  };
  if (iv.length !== PRENATAL_INTERVAL_COUNT) {
    fail(`산전 구간은 ${PRENATAL_INTERVAL_COUNT}개여야 합니다`);
    return;
  }
  if (iv[0]?.from_week !== 0) {
    fail("첫 구간은 0주에서 시작해야 합니다");
  }
  for (let i = 0; i < PRENATAL_INTERVAL_COUNT - 1; i++) {
    const cur = iv[i];
    const next = iv[i + 1];
    if (!cur || !next) continue;
    if (cur.to_week === null) {
      fail("마지막 구간만 to_week가 null일 수 있습니다");
      continue;
    }
    if (cur.to_week < cur.from_week) {
      fail("구간 시작이 끝보다 늦습니다");
    }
    if (next.from_week !== cur.to_week + 1) {
      fail("산전 구간은 연속이어야 합니다");
    }
  }
  if (iv[PRENATAL_INTERVAL_COUNT - 1]?.to_week !== null) {
    fail("마지막 구간은 출산예정일까지(to_week: null)여야 합니다");
  }
});
export type PrenatalFile = z.output<typeof PrenatalSchema>;

const Won = z.number().int().min(1).max(100_000_000);
const Day = z.number().int().min(1).max(365);

export function checkVersionTable(
  versions: readonly { effective_from: string; effective_to?: string }[],
  ctx: z.RefinementCtx,
  path: (string | number)[],
): void {
  versions.forEach((cur, i) => {
    if (cur.effective_to !== undefined && cur.effective_to < cur.effective_from) {
      ctx.addIssue({
        code: "custom",
        path: [...path, i, "effective_to"],
        message: "버전 구간 시작이 끝보다 늦습니다",
      });
    }
    if (cur.effective_to === undefined && i < versions.length - 1) {
      ctx.addIssue({
        code: "custom",
        path: [...path, i, "effective_to"],
        message: "마지막 버전만 effective_to를 생략할 수 있습니다",
      });
    }
    if (i > 0) {
      const prev = versions[i - 1];
      if (prev) {
        if (cur.effective_from <= prev.effective_from) {
          ctx.addIssue({
            code: "custom",
            path: [...path, i, "effective_from"],
            message: "버전은 effective_from 오름차순이어야 합니다",
          });
        } else if (prev.effective_to !== undefined && prev.effective_to >= cur.effective_from) {
          ctx.addIssue({
            code: "custom",
            path: [...path, i, "effective_from"],
            message: "버전 구간이 겹칩니다",
          });
        }
      }
    }
  });
}

const BenefitVersionBase = ProvenanceFields.extend({
  effective_from: IsoDate,
  effective_to: IsoDate.optional(),
  notes: z.array(z.string().min(1)),
});

const ParentAllowanceVersionSchema = BenefitVersionBase.extend({
  monthly_won: z.strictObject({ age0: Won, age1: Won }),
}).superRefine(requireVerifier);

const ChildAllowanceVersionSchema = BenefitVersionBase.extend({
  monthly_won: Won,
  age_under_years: z.number().int().min(1).max(18),
  regional_rates: z.array(z.strictObject({ label: z.string().min(1), monthly_won: Won })).min(1),
  voucher_bonus_won: Won,
}).superRefine(requireVerifier);

const FirstMeetingVersionSchema = BenefitVersionBase.extend({
  amount_won: z.strictObject({ first: Won, second_plus: Won }),
  application_period: PeriodRuleSchema,
  usage_period_note: z.string().min(1),
}).superRefine(requireVerifier);

const MedicalCostVersionSchema = BenefitVersionBase.extend({
  per_fetus_won: Won,
  usage_period_note: z.string().min(1),
  conflict_note: z.string().min(1),
}).superRefine(requireVerifier);

const versionTable = <T extends z.ZodType>(v: T) =>
  z.object({
    select_by: z.enum(["reference_date", "birth_date"]),
    versions: z.array(v).min(1),
  });

export const BenefitsSchema = z
  .object({
    parent_allowance: versionTable(ParentAllowanceVersionSchema),
    child_allowance: versionTable(ChildAllowanceVersionSchema),
    first_meeting: versionTable(FirstMeetingVersionSchema),
    pregnancy_medical: versionTable(MedicalCostVersionSchema),
  })
  .superRefine((v, ctx) => {
    for (const k of ["parent_allowance", "child_allowance", "first_meeting", "pregnancy_medical"] as const) {
      checkVersionTable(v[k].versions, ctx, [k, "versions"]);
    }
  });

export type BenefitsFile = z.output<typeof BenefitsSchema>;
export type ParentAllowanceVersion = z.output<typeof ParentAllowanceVersionSchema>;
export type ChildAllowanceVersion = z.output<typeof ChildAllowanceVersionSchema>;
export type FirstMeetingVersion = z.output<typeof FirstMeetingVersionSchema>;
export type MedicalCostVersion = z.output<typeof MedicalCostVersionSchema>;
export type BenefitTable<T> = { select_by: "reference_date" | "birth_date"; versions: T[] };

const SpouseLeaveVersionSchema = ProvenanceFields.extend({
  label: z.string().min(1),
  effective_from: IsoDate.nullable(),
  effective_to: IsoDate.nullable(),
  paid_days: z.number().int().min(1).max(60).nullable(),
  split_max: z.number().int().min(1).max(10).nullable(),
  before_due_days: z.number().int().min(1).max(120).nullable(),
  after_birth_days: z.number().int().min(1).max(365),
  notes: z.array(z.string().min(1)),
}).superRefine(requireVerifier);

const MaternityLeaveSchema = ProvenanceFields.extend({
  article_label: z.string().min(1),
  article_effective: IsoDate,
  single: z.strictObject({ total_days: Day, premature_days: Day, after_birth_min_days: Day, paid_days: Day }),
  multiple: z.strictObject({ total_days: Day, after_birth_min_days: Day, paid_days: Day }),
  notes: z.array(z.string().min(1)),
}).superRefine(requireVerifier);

const ParentalLeaveSchema = ProvenanceFields.extend({
  article_label: z.string().min(1),
  article_effective: IsoDate,
  age_under_years: z.number().int().min(1).max(18),
  age_label: z.string().min(1),
  notes: z.array(z.string().min(1)).min(1),
}).superRefine(requireVerifier);

const LeaveArticleSchema = ProvenanceFields.extend({
  article: z.number().int().min(1).max(9999),
  branch: z.number().int().min(0).max(99),
  note: z.string().min(1),
}).superRefine(requireVerifier);

export const LeaveSchema = z
  .object({
    spouse_leave: z.object({
      versions: z.array(SpouseLeaveVersionSchema),
      transition_note: z.string().min(1),
      born_mode_note: z.string().min(1),
    }),
    maternity_leave: MaternityLeaveSchema,
    parental_leave: ParentalLeaveSchema,
    articles: z.strictObject({
      spouse_leave: LeaveArticleSchema,
      maternity_leave: LeaveArticleSchema,
      parental_leave: LeaveArticleSchema,
    }),
  })
  .superRefine((v, ctx) => {
    const versions = v.spouse_leave.versions;
    const path = ["spouse_leave", "versions"];
    if (versions.length !== 2) {
      ctx.addIssue({ code: "custom", path, message: "배우자 출산휴가 버전은 2개(개정 전/후)여야 합니다" });
      return;
    }
    const old = versions[0];
    const neu = versions[1];
    if (!old || !neu) return;
    if (old.effective_to === null || neu.effective_from === null) {
      ctx.addIssue({
        code: "custom",
        path,
        message: "개정 전 버전에는 effective_to, 개정 후 버전에는 effective_from이 필요합니다",
      });
      return;
    }
    if (neu.effective_to !== null) {
      ctx.addIssue({ code: "custom", path: [...path, 1, "effective_to"], message: "개정 후 버전은 effective_to가 null이어야 합니다" });
    }
    if (old.effective_from !== null && old.effective_from > old.effective_to) {
      ctx.addIssue({ code: "custom", path: [...path, 0, "effective_to"], message: "버전 구간 시작이 끝보다 늦습니다" });
    }
    if (formatDate(addDays(parseDate(old.effective_to), 1)) !== neu.effective_from) {
      ctx.addIssue({ code: "custom", path: [...path, 1, "effective_from"], message: "두 버전이 맞닿아야 합니다(공백·중첩 불가)" });
    }
    if (neu.paid_days === null || neu.split_max === null || neu.before_due_days === null) {
      ctx.addIssue({
        code: "custom",
        path: [...path, 1],
        message: "신법 버전에는 paid_days·split_max·before_due_days가 필요합니다",
      });
    }
  });

export type LeaveFile = z.output<typeof LeaveSchema>;
export type SpouseLeaveVersion = z.output<typeof SpouseLeaveVersionSchema>;
export type MaternityLeave = z.output<typeof MaternityLeaveSchema>;
export type ParentalLeave = z.output<typeof ParentalLeaveSchema>;
export type LeaveArticle = z.output<typeof LeaveArticleSchema>;

export const LOCAL_GUIDANCE_IDS = ["health-center-prenatal", "daycare-waitlist", "local-extra-support"] as const;

const LocalGuidanceEntrySchema = ProvenanceFields.extend({
  id: z.enum(LOCAL_GUIDANCE_IDS),
  title: z.string().min(1),
  modes: z.array(z.enum(["pregnant", "born"])).min(1),
  guidance: z.array(z.string().min(1)).min(1),
  contact_template: z.string().includes("{region}", { message: "contact_template에 {region} 자리표시자가 필요합니다" }),
  contact_default: z.string().min(1),
  url: z.url().optional(),
}).superRefine(requireVerifier);

export const LocalGuidanceSchema = z
  .object({
    section_title: z.string().min(1),
    region_missing_note: z.string().min(1),
    entries: z.array(LocalGuidanceEntrySchema),
  })
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.entries.forEach((e) => {
      if (seen.has(e.id)) {
        ctx.addIssue({ code: "custom", path: ["entries"], message: `중복 지역 안내 id: ${e.id}` });
      }
      seen.add(e.id);
    });
    for (const id of LOCAL_GUIDANCE_IDS) {
      if (!seen.has(id)) {
        ctx.addIssue({ code: "custom", path: ["entries"], message: `지역 안내 항목 누락: ${id}` });
      }
    }
  });

export type LocalGuidanceFile = z.output<typeof LocalGuidanceSchema>;
export type LocalGuidanceEntry = z.output<typeof LocalGuidanceEntrySchema>;

const SidoCode = z.string().regex(/^\d{2}$/);
const SggCode = z.string().regex(/^\d{5}$/);

export const RegionVerifiedSchema = z.enum(["partial", "false"]);

export const RegionSourceSchema = z.strictObject({
  role: z.enum(["primary", "cross-check"]),
  dataset: z.string().min(1),
  provider: z.string().min(1),
  url: z.url(),
  license: z.string().min(1),
  as_of: IsoDate,
  retrieved: IsoDate,
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

export const SidoEntrySchema = z.strictObject({
  code: SidoCode,
  name: z.string().min(1),
  aliases: z.array(z.string().min(1)),
  nemc_q0: z.string().min(1),
  kindergarten_code: SidoCode.optional(),
});

export const SigunguEntrySchema = z.strictObject({
  code: SggCode,
  sido_code: SidoCode,
  name: z.string().min(1),
  parent_code: SggCode.optional(),
  aliases: z.array(z.string().min(1)),
  nemc_q1: z.string().min(1),
  codes: z.strictObject({ kindergarten: z.strictObject({ sido: SidoCode, sgg: SggCode }).optional() }),
  verified: RegionVerifiedSchema,
  created: IsoDate,
});

export const AbolishedRegionSchema = z.strictObject({
  sido_code: SidoCode,
  name: z.string().min(1),
  abolished_on: IsoDate,
  successor_codes: z.array(SggCode).min(1),
  verified: RegionVerifiedSchema,
  note: z.string().min(1),
});

export const RegionsSchema = z
  .strictObject({
    as_of: IsoDate,
    verified: VerifiedSchema,
    note: z.string().optional(),
    sources: z.array(RegionSourceSchema).min(1),
    sido: z.array(SidoEntrySchema).min(1),
    sigungu: z.array(SigunguEntrySchema).min(1),
    abolished: z.array(AbolishedRegionSchema),
  })
  .superRefine((f, ctx) => {
    if (f.verified === "full") {
      ctx.addIssue({
        code: "custom",
        path: ["verified"],
        message: "지역 데이터는 full일 수 없습니다(검증자 정보 없음)",
      });
    }
    const sidoCodes = new Set<string>();
    f.sido.forEach((s, i) => {
      if (sidoCodes.has(s.code)) {
        ctx.addIssue({ code: "custom", path: ["sido", i, "code"], message: `중복 시도 코드: ${s.code}` });
      }
      sidoCodes.add(s.code);
    });
    const sggByCode = new Map<string, z.output<typeof SigunguEntrySchema>>();
    f.sigungu.forEach((g, i) => {
      if (sggByCode.has(g.code)) {
        ctx.addIssue({ code: "custom", path: ["sigungu", i, "code"], message: `중복 시군구 코드: ${g.code}` });
      } else {
        sggByCode.set(g.code, g);
      }
    });
    f.sigungu.forEach((g, i) => {
      if (!sidoCodes.has(g.sido_code) || g.code.slice(0, 2) !== g.sido_code) {
        ctx.addIssue({
          code: "custom",
          path: ["sigungu", i, "sido_code"],
          message: "시군구 코드 앞 2자리가 sido_code와 같고 sido_code가 시도 목록에 있어야 합니다",
        });
      }
      if (g.parent_code !== undefined) {
        const parent = sggByCode.get(g.parent_code);
        if (!parent || parent.sido_code !== g.sido_code) {
          ctx.addIssue({
            code: "custom",
            path: ["sigungu", i, "parent_code"],
            message: "parent_code는 같은 시도의 존재하는 시군구여야 합니다",
          });
        }
      }
      const kg = g.codes.kindergarten;
      if (kg) {
        if (kg.sgg !== g.code || kg.sido !== g.sido_code) {
          ctx.addIssue({
            code: "custom",
            path: ["sigungu", i, "codes", "kindergarten"],
            message: "codes.kindergarten의 sgg·sido는 시군구 코드·sido_code와 같아야 합니다",
          });
        }
      } else if (g.verified !== "false") {
        ctx.addIssue({
          code: "custom",
          path: ["sigungu", i, "verified"],
          message: "코드표 대응이 없으면 verified는 false여야 합니다",
        });
      }
    });
    f.abolished.forEach((a, i) => {
      a.successor_codes.forEach((c, j) => {
        if (!sggByCode.has(c)) {
          ctx.addIssue({
            code: "custom",
            path: ["abolished", i, "successor_codes", j],
            message: `후속 코드가 현존 시군구에 없습니다: ${c}`,
          });
        }
      });
    });
  });

export type RegionsFile = z.output<typeof RegionsSchema>;
export type SidoEntry = z.output<typeof SidoEntrySchema>;
export type SigunguEntry = z.output<typeof SigunguEntrySchema>;
export type AbolishedRegion = z.output<typeof AbolishedRegionSchema>;

export const DAYCARE_STAGES = ["pregnancy", "m0_11", "m12_23", "m24_35", "age3plus", "general"] as const;
export const DAYCARE_LINK_IDS = ["info-search", "childcare-search", "childcare-waitlist", "childcare-root", "kindergarten-root"] as const;
export const DAYCARE_TYPE_IDS = ["public", "social-welfare", "corporate", "private", "home", "workplace", "cooperative"] as const;

const GuideSource = z.object({
  source: z.string().min(1),
  as_of: IsoDate,
  verified: z.enum(["partial", "false"]),
  note: z.string().min(1).optional(),
});
const GuideLines = z.array(z.string().min(1)).min(1);
const DaycareLinkSchema = GuideSource.extend({
  id: z.enum(DAYCARE_LINK_IDS),
  label: z.string().min(1),
  url: z.url(),
  purpose: z.string().min(1),
  region_param: z.literal("unverified"),
  stages: z.array(z.enum(DAYCARE_STAGES)).min(1).optional(),
});
const StageGuide = z.object({ label: z.string().min(1), lines: GuideLines });

export const DaycareGuideSchema = z
  .object({
    as_of: IsoDate,
    links: z.array(DaycareLinkSchema),
    region_steps: GuideSource.extend({
      general: GuideLines,
      with_region: z.string(),
      with_sido: z.string(),
      local_contact: z.string(),
      local_contact_default: z.string().min(1),
    }),
    comparison: GuideSource.extend({
      common: GuideLines,
      types: z.array(z.object({ id: z.enum(DAYCARE_TYPE_IDS), name: z.string().min(1), focus: GuideLines })),
    }),
    waitlist: GuideSource.extend({
      common: GuideLines,
      stages: z.object({
        pregnancy: StageGuide,
        m0_11: StageGuide,
        m12_23: StageGuide,
        m24_35: StageGuide,
        age3plus: StageGuide,
        general: StageGuide,
      }),
    }),
  })
  .superRefine((f, ctx) => {
    const linkIds = new Set<string>();
    f.links.forEach((l, i) => {
      if (linkIds.has(l.id)) {
        ctx.addIssue({ code: "custom", path: ["links", i, "id"], message: `중복 링크 id: ${l.id}` });
      }
      linkIds.add(l.id);
    });
    for (const id of DAYCARE_LINK_IDS) {
      if (!linkIds.has(id)) {
        ctx.addIssue({ code: "custom", path: ["links"], message: `링크 누락: ${id}` });
      }
    }
    f.links.forEach((l) => {
      if ([...new URL(l.url).searchParams.keys()].some((k) => k !== "menuno")) {
        ctx.addIssue({ code: "custom", path: ["links"], message: `지역 파라미터 등 미확인 쿼리 금지: ${l.id}` });
      }
    });
    if (!f.region_steps.with_region.includes("{sido}") || !f.region_steps.with_region.includes("{sigungu}")) {
      ctx.addIssue({ code: "custom", path: ["region_steps", "with_region"], message: "{sido}와 {sigungu} 자리표시자가 필요합니다" });
    }
    if (!f.region_steps.local_contact.includes("{sido}") || !f.region_steps.local_contact.includes("{sigungu}")) {
      ctx.addIssue({ code: "custom", path: ["region_steps", "local_contact"], message: "{sido}와 {sigungu} 자리표시자가 필요합니다" });
    }
    if (!f.region_steps.with_sido.includes("{sido}")) {
      ctx.addIssue({ code: "custom", path: ["region_steps", "with_sido"], message: "{sido} 자리표시자가 필요합니다" });
    }
    const typeIds = new Set<string>();
    f.comparison.types.forEach((t, i) => {
      if (typeIds.has(t.id)) {
        ctx.addIssue({ code: "custom", path: ["comparison", "types", i, "id"], message: `중복 유형 id: ${t.id}` });
      }
      typeIds.add(t.id);
    });
    for (const id of DAYCARE_TYPE_IDS) {
      if (!typeIds.has(id)) {
        ctx.addIssue({ code: "custom", path: ["comparison", "types"], message: `유형 누락: ${id}` });
      }
    }
  });

export type DaycareGuideFile = z.output<typeof DaycareGuideSchema>;
export type DaycareLinkEntry = z.output<typeof DaycareLinkSchema>;

export const CLINIC_TOOLS = ["vaccination", "checkup"] as const;
const CLINIC_QUERY_KEYS = ["menuCd", "menuLv"];

const ClinicLinkSchema = GuideSource.extend({
  id: z.string().regex(/^[a-z0-9-]+$/),
  label: z.string().min(1),
  url: z.url().optional(),
  menu_path: z.string().min(1).optional(),
  purpose: z.string().min(1),
  region_param: z.literal("unverified"),
});

const ClinicToolGuideSchema = z.object({
  links: z.array(ClinicLinkSchema).min(1),
  call_first: GuideSource.extend({ lines: GuideLines }),
  region_steps: GuideSource.extend({ general: GuideLines, with_region: z.string(), with_sido: z.string() }),
  contacts: GuideSource.extend({ lines: GuideLines, local_contact: z.string(), local_contact_default: z.string().min(1) }),
  prepare: GuideSource.extend({ lines: GuideLines }),
  stage_text: GuideSource.extend({ birth_notes: GuideLines, due_lines: GuideLines, none_lines: GuideLines }),
});

export const ClinicGuideSchema = z
  .object({ as_of: IsoDate, vaccination: ClinicToolGuideSchema, checkup: ClinicToolGuideSchema })
  .superRefine((f, ctx) => {
    for (const tool of CLINIC_TOOLS) {
      const g = f[tool];
      const linkIds = new Set<string>();
      g.links.forEach((l, i) => {
        if (linkIds.has(l.id)) {
          ctx.addIssue({ code: "custom", path: [tool, "links", i, "id"], message: `중복 링크 id: ${tool}.${l.id}` });
        }
        linkIds.add(l.id);
        if ((l.url === undefined) === (l.menu_path === undefined)) {
          ctx.addIssue({ code: "custom", path: [tool, "links", i], message: `url과 menu_path 중 하나만 필요합니다: ${l.id}` });
        }
        if (l.url !== undefined) {
          const u = new URL(l.url);
          if (u.protocol !== "https:") {
            ctx.addIssue({ code: "custom", path: [tool, "links", i, "url"], message: `https 주소만 허용: ${l.id}` });
          }
          if ([...u.searchParams.keys()].some((k) => !CLINIC_QUERY_KEYS.includes(k))) {
            ctx.addIssue({ code: "custom", path: [tool, "links", i, "url"], message: `지역 파라미터 등 미확인 쿼리 금지: ${l.id}` });
          }
        }
      });
      if (!g.region_steps.with_region.includes("{sido}") || !g.region_steps.with_region.includes("{sigungu}")) {
        ctx.addIssue({ code: "custom", path: [tool, "region_steps", "with_region"], message: "{sido}와 {sigungu} 자리표시자가 필요합니다" });
      }
      if (!g.contacts.local_contact.includes("{sido}") || !g.contacts.local_contact.includes("{sigungu}")) {
        ctx.addIssue({ code: "custom", path: [tool, "contacts", "local_contact"], message: "{sido}와 {sigungu} 자리표시자가 필요합니다" });
      }
      if (!g.region_steps.with_sido.includes("{sido}")) {
        ctx.addIssue({ code: "custom", path: [tool, "region_steps", "with_sido"], message: "{sido} 자리표시자가 필요합니다" });
      }
      if (!g.stage_text.due_lines.some((line) => line.includes("{birth_items}"))) {
        ctx.addIssue({ code: "custom", path: [tool, "stage_text", "due_lines"], message: "{birth_items} 자리표시자가 필요합니다" });
      }
    }
  });

export const HEALTH_CENTER_KINDS = ["보건소", "보건의료원", "보건지소", "보건진료소"] as const;
export const HEALTH_CENTER_PRIMARY_KINDS = ["보건소", "보건의료원"] as const;
export const HEALTH_CENTER_BASIS_ID = "health-center-standard-data";
export const HEALTH_CENTERS_MAX_BYTES = 150_000;

export const HealthCenterEntrySchema = z
  .strictObject({
    code: SggCode,
    name: z.string().min(1),
    kind: z.enum(HEALTH_CENTER_KINDS),
    phone: z.string().regex(/^[0-9-]{7,15}$/).optional(),
    homepage: z.string().regex(/^https?:\/\/\S+$/).optional(),
    address: z.string().min(1).optional(),
    source_date: IsoDate.optional(),
    verified: VerifiedSchema,
    verified_by: z.string().min(1).optional(),
    verified_on: IsoDate.optional(),
  })
  .superRefine(requireVerifier);

export const HealthCentersSchema = z
  .strictObject({
    source: z.strictObject({
      dataset_id: z.literal("15107750"),
      title: z.literal("전국보건기관표준데이터"),
      url: z.literal("https://www.data.go.kr/data/15107750/standard.do"),
      provider: z.string().min(1),
      license: z.string().min(1).nullable(),
      source_modified: IsoDate,
      file_name: z.string().min(1),
    }),
    generated_at: IsoDate,
    as_of: IsoDate,
    basis_ids: z.tuple([z.literal(HEALTH_CENTER_BASIS_ID)]),
    verified: VerifiedSchema,
    verified_by: z.string().min(1).optional(),
    verified_on: IsoDate.optional(),
    note: z.string().optional(),
    counts: z.strictObject({
      source_rows: z.number().int().nonnegative(),
      kept: z.number().int().nonnegative(),
      unmatched: z.number().int().nonnegative(),
    }),
    centers: z.array(HealthCenterEntrySchema),
  })
  .superRefine((f, ctx) => {
    requireVerifier(f, ctx);
    if (f.counts.kept !== f.centers.length) {
      ctx.addIssue({
        code: "custom",
        path: ["counts", "kept"],
        message: "kept는 centers 개수와 같아야 해요",
      });
    }
    for (let i = 1; i < f.centers.length; i++) {
      const prev = f.centers[i - 1];
      const cur = f.centers[i];
      if (prev && cur && compareCenters(prev, cur) >= 0) {
        ctx.addIssue({
          code: "custom",
          path: ["centers", i],
          message: "centers는 code·kind·name 순으로 정렬되어 있어야 해요(중복 없이)",
        });
      }
    }
  });

export function compareCenters(
  a: { code: string; kind: string; name: string },
  b: { code: string; kind: string; name: string },
): number {
  if (a.code !== b.code) return a.code < b.code ? -1 : 1;
  const ka = HEALTH_CENTER_KINDS.indexOf(a.kind as (typeof HEALTH_CENTER_KINDS)[number]);
  const kb = HEALTH_CENTER_KINDS.indexOf(b.kind as (typeof HEALTH_CENTER_KINDS)[number]);
  if (ka !== kb) return ka - kb;
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  return 0;
}

export type HealthCenterEntry = z.output<typeof HealthCenterEntrySchema>;
export type HealthCentersFile = z.output<typeof HealthCentersSchema>;
export type HealthCenterKind = (typeof HEALTH_CENTER_KINDS)[number];

export type ClinicGuideFile = z.output<typeof ClinicGuideSchema>;
export type ClinicToolGuide = z.output<typeof ClinicToolGuideSchema>;
export type ClinicLinkEntry = z.output<typeof ClinicLinkSchema>;
