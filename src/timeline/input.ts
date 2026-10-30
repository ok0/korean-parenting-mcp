import { ToolError } from "../core/errors.js";
import { compare, daysBetween, parseDate, type CivilDate } from "../date/civil-date.js";
import type { TimelineMode } from "./types.js";

export const MAX_DUE_AHEAD_DAYS = 300;
export const MAX_DUE_PAST_DAYS = 90;

export interface TimelineArgs {
  due_date?: string;
  birth_date?: string;
  region?: string;
  reference_date?: string;
  months_ahead?: number;
  include_past?: boolean;
  birth_order?: number;
  fetus_count?: number;
}

export interface ResolvedTimelineInput {
  mode: TimelineMode;
  birthDate: CivilDate;
  dueDate: CivilDate | undefined;
  referenceDate: CivilDate;
  monthsAhead: number;
  includePast: boolean;
  region: string | undefined;
  birthOrder: number | undefined;
  fetusCount: number | undefined;
}

export function resolveTimelineInput(args: TimelineArgs, today: CivilDate): ResolvedTimelineInput {
  const hasDue = args.due_date !== undefined;
  const hasBirth = args.birth_date !== undefined;
  if (hasDue === hasBirth) {
    throw new ToolError(
      "BAD_INPUT",
      hasDue
        ? "due_date(출산예정일)와 birth_date(생년월일)를 함께 줄 수 없습니다. 둘 중 하나만 주세요."
        : "due_date(출산예정일) 또는 birth_date(생년월일) 중 하나가 필요합니다.",
      {
        actions: [
          "임신 중이면 출산예정일만 주세요(예: due_date: \"2027-02-10\").",
          "출산 후면 생년월일만 주세요(예: birth_date: \"2026-01-31\").",
        ],
      },
    );
  }
  const referenceDate = args.reference_date !== undefined ? parseDate(args.reference_date) : today;

  const common = {
    monthsAhead: args.months_ahead ?? 12,
    includePast: args.include_past ?? false,
    region: args.region,
    birthOrder: args.birth_order,
    fetusCount: args.fetus_count,
  };

  if (args.due_date !== undefined) {
    const dueDate = parseDate(args.due_date);
    const ahead = daysBetween(referenceDate, dueDate);
    if (ahead > MAX_DUE_AHEAD_DAYS || ahead < -MAX_DUE_PAST_DAYS) {
      throw new ToolError(
        "BAD_INPUT",
        `due_date(출산예정일)는 기준일 ${MAX_DUE_PAST_DAYS}일 전부터 ${MAX_DUE_AHEAD_DAYS}일 후까지만 받습니다. 출산 후라면 birth_date(생년월일)를 사용하세요.`,
        {
          actions: [
            "출산 후면 birth_date로 다시 호출하세요(예: birth_date: \"2026-10-20\").",
            "예정일을 확인해 다시 주세요(예: due_date: \"2027-02-10\").",
          ],
        },
      );
    }
    return { mode: "pregnant", birthDate: dueDate, dueDate, referenceDate, ...common };
  }

  const birthDate = parseDate(args.birth_date as string);
  if (compare(referenceDate, birthDate) < 0) {
    throw new ToolError(
      "BAD_INPUT",
      "birth_date(생년월일)가 reference_date(기준일)보다 뒤입니다. 아직 태어나지 않았다면(임신 중) due_date(출산예정일)를 사용하세요.",
      {
        actions: [
          "임신 중이면 due_date로 다시 호출하세요(예: due_date: \"2027-02-10\").",
          "기준일을 바꾸려면 생년월일 이후 날짜를 주세요(예: reference_date: \"2026-02-01\").",
        ],
      },
    );
  }
  return { mode: "born", birthDate, dueDate: undefined, referenceDate, ...common };
}
