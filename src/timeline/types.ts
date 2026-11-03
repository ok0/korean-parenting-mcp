import type { CivilDate } from "../date/civil-date.js";
import type { HolidayCalendar } from "../date/holiday-calendar.js";
import type { Provenance } from "../data-store/schema.js";
import type { HealthCenterLookup } from "../region/health-centers.js";

export type Category = "신고" | "신청" | "접종" | "검진" | "휴가" | "시설" | "지원";
export type Nature = "법정 의무" | "권장" | "지원 신청" | "안내";
export type Status = "지난" | "진행 중" | "임박" | "예정";
export type TimelineMode = "pregnant" | "born";

export interface TimelineInput {
  birthDate: CivilDate;
  referenceDate: CivilDate;
  monthsAhead: number;
  includePast: boolean;
  holidays: HolidayCalendar;
  mode?: TimelineMode;
  dueDate?: CivilDate;
  region?: string;
  birthOrder?: number;
  fetusCount?: number;
}

export interface TimelineItem {
  id: string;
  category: Category;
  title: string;
  nature: Nature;
  start: CivilDate;
  end?: CivilDate;
  status?: Status;
  notes: string[];
  estimated?: boolean;
  provenance: Provenance;
}

export interface TimelineResult {
  items: TimelineItem[];
  hiddenPast: number;
  hiddenFuture: number;
  warnings: string[];
  basisIds: string[];
  notices: string[];
}

export type TimelineRule = (input: TimelineInput) => TimelineItem[];

export type TimelineNoticeRule = (input: TimelineInput) => string[];

export interface LocalGuidanceLine {
  id: string;
  title: string;
  text: string;
  contact: string;
  url?: string;
  provenance: Provenance;
}

export interface LocalGuidanceSection {
  title: string;
  region?: string;
  missingNote?: string;
  lines: LocalGuidanceLine[];
  basisIds: string[];
  healthCenter?: HealthCenterLookup;
}
