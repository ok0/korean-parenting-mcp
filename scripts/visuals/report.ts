import { SOURCE_NOTICE } from "../../src/core/notice.js";
import { TOOL_LABELS } from "./labels.js";
import { answerSection, answerTitle, normalizeAnswer, tableRowCount, type ReportSource } from "./report-source.js";
import { arrow, svgDoc, textBlock, type Theme } from "./theme.js";

export const REPORT_MAX_HEIGHT = 2000;
export const SEP = " · ";
export const BULLET = "• ";
export const REPORT_TITLE = "실제 질문과 답변으로 만든 한 장 준비 보고서";
export const QUESTION_LABEL = "AI 도우미에게 실제로 보낸 질문"; // client-neutral.test requires "AI 도우미" in visible text
export const REPORT_BADGE = "실제 답변 예시 · 한 가정의 질문에 맞춘 답변";
export const REAL_ANSWER_NOTE = (date: string): string =>
  `${date}에 한 AI 앱에서 실제로 받은 답변을 그림에 맞게 줄여서 한 장으로 구성했어요. 앱·질문·날짜에 따라 답변이 달라질 수 있어요.`;
export const REPORT_DISCLAIMER =
  "참고용 일반 안내예요. 응급 상황은 119 또는 응급실, 건강 문제는 의료진과 상의하고, 금액·자격·기한은 담당 기관에서 최종 확인하세요.";
export const REPORT_FEATURE_TOOLS = ["get_timeline", "find_benefits", "find_night_pediatric", "find_kindergarten"] as const;
export const KEYED_NOTE = "뒤의 세 가지는 키가 필요한 기능이에요";
export const MORE_LINE = (n: number): string => `외 ${n}건 더 있어요`;
export const REALTIME_FORBIDDEN: readonly RegExp[] = [
  /진료\s*중/, /진료\s*시간\s*외/,/지금\s*(진료|열)/, /오늘\s*열/, /현재\s*정원/, /정원\s*여유/, /여석/, /빈자리\s*있/, /실시간/,
];

export interface ReportSectionSpec {
  heading: string;
  answerHeading: string;
  lead: readonly string[];
  tableHeader?: readonly string[];
  items: readonly (readonly string[])[];
  countRows: boolean;
  notes: readonly string[];
  source: readonly string[];
}

export const REPORT_SECTIONS: readonly ReportSectionSpec[] = [
  {
    heading: "요약·할 일",
    answerHeading: "요약",
    lead: ["출산까지 약 4.5개월(19주) 남았습니다."],
    items: [
      ["11월", "임신부 인플루엔자 접종(무료, 출산 전까지)"],
      ["11~12월", "두 사람 회사 인사팀에 출산전후휴가·배우자 출산휴가·육아휴직 계획 공유"],
      ["출산 직후", "출생신고 + 부모급여·아동수당·첫만남이용권을 주민센터에서 한 번에 신청"],
      ["출산 후", "어린이집 입소대기 등록(아이사랑 포털)"],
    ],
    countRows: false,
    notes: ["날짜는 모두 예정일(2027-03-15) 기준 추정이며 실제 출생일에 따라 바뀝니다."],
    source: ["출처: 2026-10-31 기준 한국 육아 일정 도우미", "일정 계산(예정일 2027-03-15, 첫째)"],
  },
  {
    heading: "타임라인 핵심",
    answerHeading: "타임라인 (예정일 기준)",
    lead: [],
    items: [
      ["2027-01-24 ~ 2027-07-13", "배우자 출산휴가 20일 사용 가능 구간"],
      ["2027-02-22 ~ 2027-03-15", "산전검진 매주 1회, 출산전후휴가 시작(아내가 시작일 결정)"],
      ["2027-03-15", "출산 예정, B형간염 1차"],
      ["~2027-04-14", "출생신고(1개월, 넘기면 과태료 최대 5만원)"],
      ["~2027-05-13", "부모급여·아동수당 신청(60일 내 신청해야 출생월부터 소급)"],
      ["~2029-03-14", "첫만남이용권 신청(첫째 200만원)"],
    ],
    countRows: true,
    notes: [],
    source: [
      "출처: 2026-10-31 근거는 모자보건법 시행규칙 별표 1·근로기준법(2026-10-08 시행)·남녀고용평등법(2026-09-18 시행)·가족관계등록법·2026 국가예방접종 지침·보건복지부 임신·출산 진료비입니다.",
    ],
  },
  {
    heading: "맞벌이 휴가·휴직",
    answerHeading: "맞벌이 휴가·휴직 계획",
    lead: ["부부가 각각 육아휴직을 3개월 이상 쓰면 한쪽이 6개월을 더 쓸 수 있어, 두 사람 모두 3개월 이상 쓰는 쪽이 유리합니다."],
    items: [
      ["출산전후휴가", "아내", "90일, 출산 후 45일 이상, 최초 60일 유급"],
      ["배우자 출산휴가", "남편", "유급 20일, 3회까지 분할, 예정일 50일 전~출산 후 120일"],
      ["육아휴직", "각자", "1인 1년 이내(만 8세 이하), 부부 각 3개월 이상 사용 시 한쪽 6개월 추가"],
      ["단기 육아휴직", "각자", "연 1회 1~2주(2026-09-18 시행)"],
    ],
    countRows: true,
    notes: ["육아휴직 급여 참고값: 1~3개월 월 최대 250만원, 4~6개월 200만원, 7개월부터 160만원."],
    source: [
      "출처: 2026-10-31 근로기준법 제74조·남녀고용평등법 제18조의2·제19조와 생활법령정보 육아휴직 급여",
      "분할 횟수와 신청 절차는 회사 인사팀·고용센터에서 확인하세요.",
    ],
  },
  {
    heading: "지원금·혜택",
    answerHeading: "지원금·혜택",
    lead: ["국가 현금성 지원만 첫해 약 1,520만원(첫만남 200 + 부모급여 1,200 + 아동수당 120)이며, 서울·성동구 산후 지원이 더해집니다."],
    items: [
      ["임신·출산 진료비", "100만원 바우처", "지금, 건강보험공단·카드사"],
      ["첫만남이용권", "첫째 200만원", "출생 후 2년 내, 주민센터·정부24"],
      ["부모급여", "0세 월 100만원, 1세 월 50만원", "출생 후 60일 내"],
      ["아동수당", "월 10만원(만 9세 미만, 확대 예정)", "출생 후 60일 내"],
      ["성동구 산후조리비용", "구 거주 출산가정 지원", "성동구 건강관리과"],
    ],
    countRows: true,
    notes: [],
    source: ["출처: 2026-10-31 기준 행정안전부 공공서비스(혜택) 정보(보조금24, 성동구 출산 단계 85건 중 발췌)", "담당 기관에서 최종 확인하세요."],
  },
  {
    heading: "성동구 휴일 소아 진료",
    answerHeading: "성동구 휴일 소아 진료",
    lead: ["일요일 저녁까지 여는 곳은 달빛어린이병원인 365다움의원(왕십리역사, 24시까지) 한 곳이고, 나머지는 대부분 오전 진료입니다."],
    items: [
      ["365다움의원", "달빛어린이병원", "09:00~24:00"],
      ["아이들소아청소년과의원", "소아청소년과", "09:30~18:00"],
      ["연세드림소아청소년과의원", "소아청소년과", "09:00~13:00"],
      ["와이키즈소아청소년과의원", "소아청소년과", "08:30~13:00"],
    ],
    countRows: true,
    notes: ["응급 상황은 119 또는 응급실을 이용하세요."],
    source: ["출처: 2026-10-31 조회", "일요일 운영시간 기준 국립중앙의료원 공공데이터이며 공휴일 운영은 다를 수 있으니 방문 전 전화로 확인하세요."],
  },
  {
    heading: "어린이집·유치원",
    answerHeading: "어린이집·유치원",
    lead: [
      "맞벌이 복직 시점에 맞춰 출생 직후 어린이집 입소대기부터 걸어 두고, 유치원은 2030년 3월 만3세반 입학(2027년생 기준)을 목표로 2029년 가을 원서 접수(처음학교로)를 준비하면 됩니다.",
      "어린이집: 출생신고 후 아이사랑 등록대기 신청에서 성동구 어린이집 여러 곳에 대기를 겁니다.",
    ],
    tableHeader: ["유치원", "설립", "만3세 정원/현원"],
    items: [
      ["옥수삼성유치원", "사립", "60 / 23"],
      ["조은유치원", "사립", "30 / 11"],
      ["서울동명초 병설유치원", "공립", "14 / 2"],
    ],
    countRows: true,
    notes: [],
    source: ["출처: 2026-10-31 기준 유치원알리미 2026년 2차 공시(성동구 28곳 중 6곳)와 아이사랑 등록대기 안내이며 입학 시점엔 달라집니다."],
  },
];

export type LineKind = "lead" | "header" | "item" | "more" | "note" | "source";
export interface ReportLine { kind: LineKind; text: string }
export interface ReportSectionModel { heading: string; lines: ReportLine[] }
export interface ReportModel {
  question: string;
  answeredOn: string;
  digest: string;
  title: string;
  sections: ReportSectionModel[];
  tools: string[];
}

export function usedFeaturesLine(tools: readonly string[] = REPORT_FEATURE_TOOLS): string {
  const labels = tools.map((id) => {
    const l = TOOL_LABELS[id];
    if (!l) throw new Error(`도구 이름 없음: ${id}`);
    return l.plain;
  });
  return `사용한 기능: ${labels.join(", ")}${SEP}${KEYED_NOTE}`;
}

function verbatim(section: string, heading: string, text: string): string {
  for (const seg of text.split(SEP)) {
    if (!section.includes(seg)) throw new Error(`정리본에 없는 내용(${heading}): ${seg}`);
  }
  return text;
}

export function buildReportModel(src: ReportSource, specs: readonly ReportSectionSpec[] = REPORT_SECTIONS): ReportModel {
  const norm = normalizeAnswer(src.answer);
  const sections = specs.map((s) => {
    const body = answerSection(norm, s.answerHeading);
    const v = (t: string): string => verbatim(body, s.heading, t);
    if (s.source.length === 0) throw new Error(`출처 없음: ${s.heading}`);
    const lines: ReportLine[] = [];
    for (const t of s.lead) lines.push({ kind: "lead", text: v(t) });
    if (s.tableHeader) lines.push({ kind: "header", text: v(s.tableHeader.join(SEP)) });
    for (const it of s.items) lines.push({ kind: "item", text: v(it.join(SEP)) });
    if (s.countRows) {
      const more = tableRowCount(body) - s.items.length;
      if (more < 0) throw new Error(`표 행 수보다 많이 골랐습니다: ${s.heading}`);
      if (more > 0) lines.push({ kind: "more", text: MORE_LINE(more) });
    }
    for (const t of s.notes) lines.push({ kind: "note", text: v(t) });
    lines.push({ kind: "source", text: v(s.source.join(SEP)) });
    return { heading: s.heading, lines };
  });
  return {
    question: src.question,
    answeredOn: src.answeredOn,
    digest: src.digest,
    title: answerTitle(norm),
    sections,
    tools: [...REPORT_FEATURE_TOOLS],
  };
}

export function renderReport(m: ReportModel, theme: Theme): string {
  const width = 1200;
  const paperX = 440;
  const paperY = 51;
  const paperW = 720;
  const X = 476;
  const W = 648;

  const qLabel = textBlock({
    x: 24,
    y: 96,
    text: QUESTION_LABEL,
    maxWidth: 340,
    fontSize: 15,
    bold: true,
    fill: theme.accent,
  });
  const qBody = textBlock({
    x: 44,
    y: 140,
    text: m.question,
    maxWidth: 300,
    fontSize: 16,
    lineHeight: 24,
    fill: theme.text,
  });
  const bubbleH = 32 + qBody.lines * 24;
  const bubble = `<rect x="24" y="110" width="340" height="${bubbleH}" rx="12" fill="${theme.surface}" stroke="${theme.border}"/>`;
  const leftSide = [qLabel.svg, bubble, qBody.svg, arrow(372, 110 + bubbleH / 2, 432, theme.muted)].join("\n");

  const paper: string[] = [];
  let y = paperY + 60;

  const block = (
    gap: number,
    o: { text: string; fontSize: number; fill: string; lineHeight?: number; bold?: boolean },
  ): void => {
    y += gap;
    const b = textBlock({ x: X, y, maxWidth: W, ...o });
    paper.push(b.svg);
    y += b.height;
  };

  const rule = (gap: number): void => {
    y += gap;
    paper.push(`<line x1="${X}" y1="${y}" x2="${X + W}" y2="${y}" stroke="${theme.border}" stroke-width="1"/>`);
  };

  block(0, { text: m.title, fontSize: 20, bold: true, lineHeight: 28, fill: theme.text });
  block(10, { text: REPORT_BADGE, fontSize: 14, bold: true, fill: theme.accent });
  block(6, { text: REAL_ANSWER_NOTE(m.answeredOn), fontSize: 13, lineHeight: 19, fill: theme.muted });
  rule(14);

  for (const s of m.sections) {
    block(18, { text: s.heading, fontSize: 16, bold: true, lineHeight: 22, fill: theme.text });
    for (const line of s.lines) {
      if (line.kind === "lead") {
        block(0, { text: line.text, fontSize: 14, lineHeight: 20, fill: theme.text });
      } else if (line.kind === "header") {
        block(0, { text: line.text, fontSize: 13, lineHeight: 19, fill: theme.muted });
      } else if (line.kind === "item") {
        block(0, { text: BULLET + line.text, fontSize: 14, lineHeight: 20, fill: theme.text });
      } else if (line.kind === "more") {
        block(0, { text: BULLET + line.text, fontSize: 14, lineHeight: 20, fill: theme.muted });
      } else if (line.kind === "note") {
        block(0, { text: line.text, fontSize: 13, lineHeight: 19, fill: theme.muted });
      } else {
        block(4, { text: line.text, fontSize: 13, lineHeight: 19, fill: theme.muted });
      }
    }
  }

  rule(22);
  block(14, { text: usedFeaturesLine(m.tools), fontSize: 13, lineHeight: 19, fill: theme.muted });
  block(0, { text: SOURCE_NOTICE, fontSize: 13, lineHeight: 19, fill: theme.muted });
  block(0, { text: REPORT_DISCLAIMER, fontSize: 13, lineHeight: 19, fill: theme.muted });

  const paperH = y - paperY + 24;
  const height = paperY + paperH + paperY;
  if (height > REPORT_MAX_HEIGHT) throw new Error(`보고서가 최대 높이를 넘칩니다: ${height} > ${REPORT_MAX_HEIGHT}`);

  const paperGroup = [
    `<g data-source="sha256-${m.digest}">`,
    `<rect x="${paperX}" y="${paperY}" width="${paperW}" height="${paperH}" rx="6" fill="${theme.surface}" stroke="${theme.border}"/>`,
    ...paper,
    `</g>`,
  ].join("\n");

  const desc = `실제 답변 예시 그림. ${m.answeredOn}에 한 AI 앱에 보낸 질문: ${m.question} 그 앱에서 받은 실제 답변을 그림에 맞게 한 장으로 줄인 보고서. 사용한 기능: ${m.tools.join(", ")}.`;

  return svgDoc({
    width,
    height,
    title: REPORT_TITLE,
    desc,
    theme,
    body: [leftSide, paperGroup].join("\n"),
  });
}
