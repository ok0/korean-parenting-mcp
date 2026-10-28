import type { CivilDate } from "../../date/civil-date.js";
import { offsetRange } from "../../date/offsets.js";
import { loadData } from "../../data-store/load.js";
import type { CheckupOffset, CheckupProgram } from "../../data-store/schema.js";
import { pickProvenance } from "./common.js";
import type { TimelineRule } from "../types.js";

export const PROGRAM_LABEL: Record<CheckupProgram, string> = {
  infant: "영유아 건강검진",
  oral: "영유아 구강검진",
};

export function checkupRange(
  birth: CivilDate,
  from: CheckupOffset,
  to: CheckupOffset,
): { start: CivilDate; end: CivilDate } {
  return offsetRange(birth, from, to);
}

export function rangeLabel(from: CheckupOffset, to: CheckupOffset): string {
  if ("days" in from) {
    if (!("days" in to)) {
      throw new Error("검진 기간의 from과 to 단위가 다릅니다");
    }
    return `생후 ${from.days}~${to.days}일`;
  }
  if (!("months" in to)) {
    throw new Error("검진 기간의 from과 to 단위가 다릅니다");
  }
  return `${from.months}~${to.months}개월`;
}

export const checkupRule: TimelineRule = (input) =>
  loadData("checkups").checkups.map((e) => {
    const r = checkupRange(input.birthDate, e.from, e.to);
    return {
      id: e.id,
      category: "검진",
      title: `${PROGRAM_LABEL[e.program]} ${e.round}차 (${rangeLabel(e.from, e.to)})`,
      nature: "권장",
      start: r.start,
      end: r.end,
      notes: [...e.notes],
      provenance: pickProvenance(e),
    };
  });
