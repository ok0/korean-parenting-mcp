import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPORT_SOURCE_REL = "test/fixtures/visuals";
export const QUESTION_FILE = "real-question.md";
export const ANSWER_FILE = "real-answer.md";
export const REPORT_SOURCE_FILES = [ANSWER_FILE, QUESTION_FILE] as const;
const DATE_HEAD = /^<!-- 받은 날짜: (\d{4}-\d{2}-\d{2}) -->\n/;

export interface ReportSource {
  question: string;
  answer: string;
  answeredOn: string;
  digest: string;
}

/** 모듈 위치에서 위로 올라가며 정리본 폴더를 찾는다(scripts/visuals, build-scripts/scripts/visuals 모두). process.cwd()를 쓰지 않는다. */
export function reportSourceDir(from: string = import.meta.url): string {
  let dir = dirname(fileURLToPath(from));
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, REPORT_SOURCE_REL);
    if (existsSync(join(candidate, ANSWER_FILE))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("실제 답변 정리본 폴더를 찾을 수 없습니다");
}

export function parseReportSource(questionText: string, answerText: string): ReportSource {
  const q = questionText.replace(/\r\n/g, "\n");
  const a = answerText.replace(/\r\n/g, "\n");
  const question = q.trim();
  if (question.length === 0) throw new Error("정리본 질문이 비어 있습니다");
  const head = DATE_HEAD.exec(a);
  if (!head || head[1] === undefined) throw new Error("정리본 첫 줄에 받은 날짜가 없습니다");
  const digest = createHash("sha256").update(q).update("\0").update(a).digest("hex").slice(0, 16);
  return { question, answer: a.slice(head[0].length), answeredOn: head[1], digest };
}

export function loadReportSource(dir: string = reportSourceDir()): ReportSource {
  return parseReportSource(readFileSync(join(dir, QUESTION_FILE), "utf8"), readFileSync(join(dir, ANSWER_FILE), "utf8"));
}

/** 마크다운 표기만 걷어 낸다: \~ → ~, ** 제거, [글](주소) → 글. */
export function normalizeAnswer(md: string): string {
  return md.replace(/\\~/g, "~").replace(/\*\*/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
}

export function answerTitle(norm: string): string {
  const m = /^# (.+)$/m.exec(norm);
  if (!m || m[1] === undefined) throw new Error("정리본에 제목이 없습니다");
  return m[1].trim();
}

export function answerSection(norm: string, heading: string): string {
  const lines = norm.split("\n");
  const start = lines.indexOf(`## ${heading}`);
  if (start < 0) throw new Error(`정리본에 없는 구획: ${heading}`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith("## "));
  return (end < 0 ? rest : rest.slice(0, end)).join("\n");
}

/** 구획 안 표의 데이터 행 수(머리글·구분선 2줄 제외). 구획마다 표는 하나. */
export function tableRowCount(section: string): number {
  const rows = section.split("\n").filter((l) => l.trim().startsWith("|")).length;
  return Math.max(0, rows - 2);
}
