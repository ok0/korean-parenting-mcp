import { daycareStage } from "../../src/daycare/guide.js";
import { addMonthsClamp, compare, daysBetween, formatDate, type CivilDate } from "../../src/date/civil-date.js";
import type { OfflineTimeline } from "../../src/timeline/offline.js";
import { lmpFromDue } from "../../src/timeline/rules/prenatal.js";
import type { TimelineItem } from "../../src/timeline/types.js";
import { escapeXml, fmt, svgDoc, textBlock, type Theme } from "./theme.js";

export type Lane = "prenatal" | "vaccination" | "checkup" | "deadline" | "support" | "leave" | "facility";

export const LANES: readonly { lane: Lane; title: string }[] = [
  { lane: "prenatal", title: "산전검진" },
  { lane: "vaccination", title: "예방접종" },
  { lane: "checkup", title: "영유아·구강검진" },
  { lane: "deadline", title: "신고·신청 기한" },
  { lane: "support", title: "지원금" },
  { lane: "leave", title: "휴가" },
  { lane: "facility", title: "어린이집·유치원 안내" },
];

export function laneOf(item: TimelineItem): Lane {
  if (item.category === "검진" && item.id.startsWith("prenatal-")) return "prenatal";
  if (item.category === "검진" && (item.id.startsWith("infant-checkup-") || item.id.startsWith("oral-checkup-"))) {
    return "checkup";
  }
  if (item.category === "접종") return "vaccination";
  if (item.category === "신고" || item.category === "신청") return "deadline";
  if (item.category === "지원") return "support";
  if (item.category === "휴가") return "leave";
  if (item.category === "시설") return "facility";
  throw new Error(`알 수 없는 줄: ${item.id} (${item.category})`);
}

export interface StageBand {
  key: "pregnancy" | "infant" | "child";
  label: string;
  start: CivilDate;
  end: CivilDate;
}

export function stageBands(birth: CivilDate): StageBand[] {
  return [
    { key: "pregnancy", label: "임신", start: lmpFromDue(birth), end: birth },
    { key: "infant", label: "영아 (만 0~2세)", start: birth, end: addMonthsClamp(birth, 36) },
    { key: "child", label: "유아 (만 3~5세)", start: addMonthsClamp(birth, 36), end: addMonthsClamp(birth, 72) },
  ];
}

export interface FacilityMark {
  stage: "m0_11" | "m12_23" | "m24_35" | "age3plus";
  date: CivilDate;
  label: string;
}

export function facilityMarks(birth: CivilDate): FacilityMark[] {
  const marks: FacilityMark[] = [
    { stage: "m0_11", date: addMonthsClamp(birth, 0), label: "0~11개월 안내" },
    { stage: "m12_23", date: addMonthsClamp(birth, 12), label: "12~23개월 안내" },
    { stage: "m24_35", date: addMonthsClamp(birth, 24), label: "24~35개월 안내" },
    { stage: "age3plus", date: addMonthsClamp(birth, 36), label: "만 3세 이상 안내(유치원 포함)" },
  ];
  for (const mark of marks) {
    const r = daycareStage({ birth }, mark.date);
    if (!r.ok || r.stage !== mark.stage) {
      throw new Error(`어린이집 단계 경계 불일치: ${mark.label} (${formatDate(mark.date)})`);
    }
  }
  return marks;
}

const X0 = 200;
const X1 = 1170;
const LEFT = 30;
const LANE_TOP = 166;
const LANE_H = 64;
const AXIS_Y = LANE_TOP + LANES.length * LANE_H + 8;

const CALLOUTS: Record<Exclude<Lane, "facility">, ReadonlyArray<ReadonlyArray<readonly [id: string, template: string]>>> = {
  prenatal: [
    [
      ["prenatal-checkup-1", "임신 중 정기 검진 {start}부터"],
      ["prenatal-checkup-3", "막달에는 매주 · ~{end}"],
    ],
  ],
  vaccination: [
    [["vac-hepb-1", "첫 예방접종(태어날 때) {start}"]],
    [["vac-dtap-5", "만 4~6세 접종 ~{end}"]],
  ],
  checkup: [[["infant-checkup-1", "영유아 건강검진 {countInfant}번 · 구강검진 {countOral}번"]]],
  deadline: [
    [
      ["birth-registration", "출생신고 ~{end}"],
      ["parent-allowance", "부모급여 신청 ~{end}"],
    ],
  ],
  support: [
    [
      ["pregnancy-medical-cost", "임신·출산 진료비 지원 ~{end}"],
      ["parent-allowance-age0", "부모급여 {start}부터 · 아동수당 ~{child-allowance-period.end}"],
    ],
  ],
  leave: [
    [
      ["spouse-leave", "배우자 출산휴가 {start}~{end}"],
      ["parental-leave", "출산전후휴가 {maternity-leave.start}부터 · 육아휴직 ~{end}"],
    ],
  ],
};

export function renderLifeTimeline(t: OfflineTimeline, theme: Theme): string {
  if (t.view.mode !== "pregnant") {
    throw new Error("임신 중 모드 타임라인만 그릴 수 있어요");
  }
  const birth = t.view.birthDate;
  const axisStart = lmpFromDue(birth);
  const axisEnd = addMonthsClamp(birth, 72);
  const span = daysBetween(axisStart, axisEnd);
  const xOf = (d: CivilDate): number => X0 + (daysBetween(axisStart, d) / span) * (X1 - X0);
  const topOf = (lane: Lane): number => LANE_TOP + LANES.findIndex((l) => l.lane === lane) * LANE_H;
  const fillOf = (lane: Lane): string => (lane === "deadline" ? theme.barDeadline : theme.bar);

  const byId = new Map(t.result.items.map((item) => [item.id, item] as const));
  const itemOf = (id: string): TimelineItem => {
    const item = byId.get(id);
    if (item === undefined) throw new Error(`그림 항목 없음: ${id}`);
    return item;
  };
  const dateText = (item: TimelineItem, which: "start" | "end"): string => {
    if (which === "start") return formatDate(item.start);
    if (item.end === undefined) throw new Error(`끝 날짜 없음: ${item.id}`);
    return formatDate(item.end);
  };
  const infantCount = t.result.items.filter((item) => item.id.startsWith("infant-checkup-")).length;
  const oralCount = t.result.items.filter((item) => item.id.startsWith("oral-checkup-")).length;
  const fillTemplate = (tpl: string, self: TimelineItem): string =>
    tpl.replace(/\{([^{}]+)\}/g, (_match, key: string) => {
      if (key === "countInfant") return String(infantCount);
      if (key === "countOral") return String(oralCount);
      if (key === "start" || key === "end") return dateText(self, key);
      const ref = /^(.+)\.(start|end)$/.exec(key);
      if (ref === null) throw new Error(`알 수 없는 치환: {${key}}`);
      return dateText(itemOf(ref[1] ?? ""), ref[2] === "start" ? "start" : "end");
    });

  const parts: string[] = [];

  parts.push(
    textBlock({
      x: LEFT,
      y: 44,
      text: "임신부터 만 6세까지 한눈에 (예시)",
      maxWidth: 1140,
      fontSize: 22,
      bold: true,
      fill: theme.text,
    }).svg,
  );
  parts.push(
    textBlock({
      x: LEFT,
      y: 70,
      text: `출산예정일 ${formatDate(birth)} 예시로 계산한 일정이에요 (개인 맞춤 아님)`,
      maxWidth: 1140,
      fontSize: 13,
      fill: theme.muted,
    }).svg,
  );

  for (const band of stageBands(birth)) {
    const fill = band.key === "pregnancy" ? theme.bandPregnancy : band.key === "infant" ? theme.bandInfant : theme.bandChild;
    const bx1 = xOf(band.start);
    const bx2 = xOf(band.end);
    const bw = bx2 - bx1;
    parts.push(`<rect x="${fmt(bx1)}" y="100" width="${fmt(bw)}" height="36" fill="${fill}"/>`);
    parts.push(
      textBlock({
        x: (bx1 + bx2) / 2,
        y: 123,
        text: band.label,
        maxWidth: bw - 8,
        fontSize: 13,
        bold: true,
        fill: theme.text,
        anchor: "middle",
      }).svg,
    );
  }

  const xBirth = xOf(birth);
  parts.push(
    textBlock({
      x: xBirth + 6,
      y: 154,
      text: `출산 예정 ${formatDate(birth)}`,
      maxWidth: xOf(addMonthsClamp(birth, 36)) - xBirth - 12,
      fontSize: 12,
      bold: true,
      fill: theme.text,
    }).svg,
  );
  parts.push(
    textBlock({
      x: X1,
      y: 154,
      text: `만 6세 ${formatDate(axisEnd)}`,
      maxWidth: 200,
      fontSize: 12,
      fill: theme.text,
      anchor: "end",
    }).svg,
  );
  parts.push(
    `<line x1="${fmt(xBirth)}" y1="136" x2="${fmt(xBirth)}" y2="${LANE_TOP}" stroke="${theme.text}" opacity="0.5" stroke-dasharray="4 4"/>`,
  );

  LANES.forEach(({ title }, i) => {
    const top = LANE_TOP + i * LANE_H;
    parts.push(
      `<line x1="${fmt(xBirth)}" y1="${fmt(top + 4)}" x2="${fmt(xBirth)}" y2="${fmt(top + 26)}" stroke="${theme.text}" opacity="0.5" stroke-dasharray="4 4"/>`,
    );
    parts.push(
      textBlock({
        x: LEFT,
        y: top + 38,
        text: title,
        maxWidth: 160,
        fontSize: 13,
        bold: true,
        fill: theme.text,
      }).svg,
    );
    parts.push(
      `<line x1="${LEFT}" y1="${fmt(top + LANE_H)}" x2="${X1}" y2="${fmt(top + LANE_H)}" stroke="${theme.border}" stroke-width="1"/>`,
    );
  });

  const shown = t.result.items.filter((item) => compare(item.start, axisEnd) <= 0);
  const beyond = t.result.items.length - shown.length;
  for (const item of shown) {
    const lane = laneOf(item);
    const top = topOf(lane);
    const fill = fillOf(lane);
    if (item.end !== undefined) {
      const s = compare(item.start, axisStart) < 0 ? axisStart : item.start;
      const e = compare(item.end, axisEnd) > 0 ? axisEnd : item.end;
      const bx = xOf(s);
      const bw = Math.max(3, xOf(e) - bx);
      parts.push(
        `<rect data-item="${escapeXml(item.id)}" data-lane="${lane}" x="${fmt(bx)}" y="${fmt(top + 10)}" width="${fmt(bw)}" height="10" rx="2" fill="${fill}" fill-opacity="0.55"/>`,
      );
    } else {
      parts.push(
        `<circle data-item="${escapeXml(item.id)}" data-lane="${lane}" cx="${fmt(xOf(item.start))}" cy="${fmt(top + 15)}" r="5" fill="${fill}" fill-opacity="0.55"/>`,
      );
    }
  }

  for (const { lane } of LANES) {
    if (lane === "facility") continue;
    const placed = CALLOUTS[lane].map((block) => {
      const first = block[0];
      if (first === undefined) throw new Error(`빈 설명 묶음: ${lane}`);
      return { block, x: Math.max(X0, xOf(itemOf(first[0]).start)) + 4 };
    });
    placed.forEach((p, j) => {
      const next = placed[j + 1];
      const maxWidth = next !== undefined ? next.x - p.x - 8 : X1 - p.x;
      const lines = p.block.map(([id, tpl]) => fillTemplate(tpl, itemOf(id)));
      parts.push(
        textBlock({
          x: p.x,
          y: topOf(lane) + 38,
          text: lines,
          maxWidth,
          fontSize: 12,
          lineHeight: 16,
          fill: theme.text,
          maxLines: 2,
        }).svg,
      );
    });
  }

  const marks = facilityMarks(birth);
  marks.forEach((mark, j) => {
    const x = xOf(mark.date);
    const top = topOf("facility");
    const nextMark = marks[j + 1];
    const maxWidth = nextMark !== undefined ? xOf(nextMark.date) - x - 8 : X1 - x - 4;
    const label = textBlock({
      x: x + 4,
      y: top + 38,
      text: [mark.label, formatDate(mark.date)],
      maxWidth,
      fontSize: 12,
      lineHeight: 16,
      fill: theme.text,
    });
    parts.push(`<g data-stage="${mark.stage}" data-tools="find_daycare find_kindergarten">`);
    parts.push(
      `<line x1="${fmt(x)}" y1="${fmt(top + 8)}" x2="${fmt(x)}" y2="${fmt(top + 22)}" stroke="${theme.accent}" stroke-width="2"/>`,
    );
    parts.push(label.svg);
    parts.push("</g>");
  });

  parts.push(`<line x1="${X0}" y1="${AXIS_Y}" x2="${X1}" y2="${AXIS_Y}" stroke="${theme.muted}" stroke-width="1"/>`);
  for (let y = axisStart.y; y <= axisEnd.y; y++) {
    const jan1: CivilDate = { y, m: 1, d: 1 };
    if (compare(jan1, axisStart) > 0 && compare(jan1, axisEnd) <= 0) {
      parts.push(
        textBlock({
          x: xOf(jan1),
          y: AXIS_Y + 16,
          text: `${y}년`,
          maxWidth: 60,
          fontSize: 11,
          fill: theme.muted,
          anchor: "middle",
        }).svg,
      );
    }
  }

  const maxAsOf = t.result.items.map((item) => item.provenance.as_of).reduce((a, b) => (b > a ? b : a), "");
  const holidayYears = new Set<number>();
  for (const item of t.result.items) {
    for (const note of item.notes) {
      const m = /^(\d{4})년 공휴일 정보 없음/.exec(note);
      if (m?.[1] !== undefined) holidayYears.add(Number(m[1]));
    }
  }
  const years = [...holidayYears].sort((a, b) => a - b);
  const footer: { text: string; fill: string }[] = [
    {
      text: `예시 그림: 출산예정일 ${formatDate(birth)} · 기준일 ${formatDate(t.view.referenceDate)}로 계산 · 개인 맞춤 아님`,
      fill: theme.text,
    },
    {
      text: `비공식 도구예요. 실제 일정과 기한은 관할 기관과 의료진에게 꼭 확인하세요 · 데이터 기준일 ${maxAsOf}`,
      fill: theme.text,
    },
  ];
  if (years.length > 0) {
    footer.push({
      text: `※ ${years.join("·")}년 공휴일 정보가 아직 없어, 그 해에 끝나는 기한은 휴일로 늦춰지는 경우를 넣지 않고 원래 날짜로 그렸어요.`,
      fill: theme.muted,
    });
  }
  if (beyond + t.result.hiddenFuture > 0) {
    footer.push({
      text: `※ 만 6세 이후 일정 ${beyond + t.result.hiddenFuture}개는 그림에서 뺐어요.`,
      fill: theme.muted,
    });
  }
  let footerY = AXIS_Y + 46;
  let lastBaseline = footerY;
  for (const line of footer) {
    const block = textBlock({
      x: LEFT,
      y: footerY,
      text: line.text,
      maxWidth: 1140,
      fontSize: 12,
      lineHeight: 17,
      fill: line.fill,
    });
    parts.push(block.svg);
    lastBaseline = footerY + block.height - 17;
    footerY += block.height + 4;
  }

  const H = lastBaseline + 28;
  return svgDoc({
    width: 1200,
    height: H,
    title: "임신부터 만 6세까지 육아 일정 예시",
    desc: `출산예정일 ${formatDate(birth)} 예시로 계산한 산전검진·예방접종·영유아검진·신고와 신청 기한·지원금·휴가·어린이집과 유치원 안내 단계 그림입니다.`,
    theme,
    body: parts.join("\n"),
  });
}
