import type { ClinicLink, ClinicToolGuideContent } from "../../clinic/guide.js";
import { childStage, type ChildStage, type WindowItem } from "../../clinic/stage.js";
import type { ToolContext } from "../../core/context.js";
import { ToolError } from "../../core/errors.js";
import { formatDate, parseDate, todayKst, type CivilDate } from "../../date/civil-date.js";
import { resolveBasis } from "../../data-store/load.js";
import type { Provenance } from "../../data-store/schema.js";
import { normalizeRegion, type Region } from "../../region/normalize.js";
import { NOTICE_UNOFFICIAL, composeFooter, verifiedText } from "./format.js";

export const NOTICE_LINK_CHANGE_CLINIC =
  "링크 변경 가능: 누리집 개편에 따라 주소나 메뉴가 바뀔 수 있습니다. 링크가 열리지 않으면 첫 화면(대체 링크)에서 메뉴를 찾아가세요. 바로가기 주소를 확인하지 못한 항목은 메뉴 경로로만 적었습니다(확인 필요).";
export const NOTICE_FINAL_CLINIC =
  "최종 확인: 접종·검진 일정, 기관 지정 여부, 준비물은 공식 사이트(질병관리청 예방접종도우미, 국민건강보험공단), 해당 의료기관, 관할 보건소에서 확인하세요.";
export const NOTICE_MEDICAL_CLINIC =
  "의료 면책: 이 안내는 일반 정보이며 진단·처방이나 접종·검진 시기 판단이 아닙니다. 아이의 상태와 접종·검진 여부는 의료진과 상담하세요.";

export interface SourceLike {
  source: string;
  as_of: string;
  verified: "partial" | "false";
  note?: string;
}

export function srcLine(p: SourceLike): string {
  return `출처: ${p.source} · 기준일 ${p.as_of} · ${verifiedText(p.verified)}` + (p.note ? ` · ${p.note}` : "");
}

export function uniq<T>(xs: readonly T[]): T[] {
  return [...new Set(xs)];
}

export function timelineSourceLine(ps: readonly Provenance[]): string {
  const titles = resolveBasis(uniq(ps.flatMap((p) => p.basis_ids)))
    .map((d) => d.title)
    .join(", ");
  const asOf = uniq(ps.map((p) => p.as_of)).join(", ");
  const verified = uniq(ps.map((p) => verifiedText(p.verified))).join("/");
  return `출처: ${titles} · 기준일 ${asOf} · ${verified}`;
}

export function itemLine(i: WindowItem): string {
  return `${i.title}: ${formatDate(i.start)}~${formatDate(i.end)} · ${verifiedText(i.provenance.verified)}`;
}

export function parseClinicInput(
  args: { birth_date?: string; due_date?: string; today?: string },
  ctx: ToolContext,
): { today: CivilDate; stage: ChildStage } {
  if (args.birth_date !== undefined && args.due_date !== undefined) {
    throw new ToolError(
      "BAD_INPUT",
      "birth_date와 due_date는 함께 쓸 수 없습니다. 출산 전이면 due_date, 출산 후면 birth_date 하나만 입력하세요.",
    );
  }
  const today = args.today !== undefined ? parseDate(args.today) : todayKst(ctx.clock);
  const st = childStage(
    {
      birth: args.birth_date !== undefined ? parseDate(args.birth_date) : undefined,
      due: args.due_date !== undefined ? parseDate(args.due_date) : undefined,
    },
    today,
  );
  if (!st.ok) throw new ToolError("BAD_INPUT", st.message);
  return { today, stage: st.stage };
}

function regionFailNote(message: string, candidates: readonly Region[]): string {
  let note = `지역을 확인해 주세요: ${message}`;
  if (candidates.length > 0) {
    note +=
      "\n후보:\n" +
      candidates.map((c) => `- ${c.sido} ${c.sigungu ?? ""}`.trim()).join("\n") +
      "\n후보 중 하나를 region으로 다시 조회하면 지역 선택 절차가 구체화됩니다.";
  }
  return note + "\n아래 링크와 안내는 지역 없이 표시합니다.";
}

export function resolveRegion(input: string | undefined): { region?: Region; note?: string } {
  if (input === undefined) return {};
  const r = normalizeRegion(input);
  if (r.ok) return { region: r.region };
  return { note: regionFailNote(r.message, r.candidates) };
}

export function regionLabel(region: Region | undefined): string {
  return region !== undefined ? [region.sido, region.sigungu].filter(Boolean).join(" ") : "미지정";
}

export function stageLabel(stage: ChildStage): string {
  switch (stage.kind) {
    case "birth":
      return `생후 ${stage.months}개월(생년월일 ${formatDate(stage.birth)})`;
    case "due":
      return `출산 전(출산예정일 ${formatDate(stage.due)})`;
    case "none":
      return "아이 정보 없음(일반 안내)";
  }
}

export function fillRegion(t: string, region: Region): string {
  return t.replaceAll("{sido}", region.sido).replaceAll("{sigungu}", region.sigungu ?? "");
}

export function renderCommonSections(
  g: ClinicToolGuideContent,
  links: readonly ClinicLink[],
  region: Region | undefined,
): string[] {
  const out: string[] = ["[먼저 전화로 확인]"];
  for (const line of g.call_first.lines) out.push(`- ${line}`);
  out.push(`  ${srcLine(g.call_first)}`, "");

  out.push("[링크]");
  for (const l of links) {
    if (l.url !== undefined) {
      out.push(`- ${l.label}: ${l.url}`);
    } else {
      out.push(`- ${l.label} (메뉴 경로, 바로가기 주소 확인 필요): ${l.menu_path}`);
    }
    out.push(`  용도: ${l.purpose}`, `  ${srcLine(l)}`);
  }
  out.push(NOTICE_LINK_CHANGE_CLINIC, "");

  out.push("[지역 선택 절차]");
  if (region !== undefined && region.sigungu !== undefined) {
    out.push(`- ${fillRegion(g.region_steps.with_region, region)}`);
  } else if (region !== undefined) {
    out.push(`- ${fillRegion(g.region_steps.with_sido, region)}`);
  } else {
    for (const line of g.region_steps.general) out.push(`- ${line}`);
  }
  out.push(`  ${srcLine(g.region_steps)}`, "");

  out.push("[문의처]");
  for (const line of g.contacts.lines) out.push(`- ${line}`);
  if (region !== undefined && region.sigungu !== undefined) {
    out.push(`- ${fillRegion(g.contacts.local_contact, region)}`);
  } else {
    out.push(`- ${g.contacts.local_contact_default}`);
  }
  out.push(`  ${srcLine(g.contacts)}`, "");

  out.push("[준비물·확인 사항]");
  for (const line of g.prepare.lines) out.push(`- ${line}`);
  out.push(`  ${srcLine(g.prepare)}`, "");

  return out;
}

export function clinicFooter(asOf: string): string {
  return composeFooter([
    NOTICE_FINAL_CLINIC,
    NOTICE_MEDICAL_CLINIC,
    `안내 데이터 기준일 ${asOf} · 조회 없음(외부 호출 0회)`,
    NOTICE_UNOFFICIAL,
  ]);
}
