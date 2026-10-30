import { computeForPage, kstToday, type PageCard, type PageResult } from "./app.js";
import { toTimelineArgs } from "./form.js";

export { computeForPage, kstToday } from "./app.js";
export type { PageCard, PageResult } from "./app.js";
export { toTimelineArgs } from "./form.js";
export type { FormValues } from "./form.js";

const IDS = {
  due: "due-date", order: "birth-order", months: "months-ahead", button: "compute",
  error: "error", result: "result", asOf: "as-of", cards: "cards", raw: "raw-text",
} as const;

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error("페이지 요소가 없습니다: " + id);
  return e as T;
}

function cardItem(c: PageCard): HTMLLIElement {
  const li = document.createElement("li");
  li.className = "card";
  const title = document.createElement("h3");
  title.textContent = c.title;
  const date = document.createElement("p");
  date.className = "card-date";
  date.textContent = c.end ? c.date + " ~ " + c.end : c.date;
  const meta = document.createElement("p");
  meta.className = "card-meta";
  meta.textContent = [c.status, c.category, c.nature].filter((x) => x !== null).join(" · ");
  const source = document.createElement("p");
  source.className = "card-source";
  source.textContent = "출처 " + c.source;
  li.append(title, date, meta, source);
  return li;
}

function showError(message: string): void {
  const error = el<HTMLElement>(IDS.error);
  const result = el<HTMLElement>(IDS.result);
  error.textContent = message;
  error.hidden = false;
  result.hidden = true;
  el<HTMLElement>(IDS.cards).replaceChildren();
  el<HTMLElement>(IDS.raw).textContent = "";
  el<HTMLElement>(IDS.asOf).textContent = "";
}

function run(): void {
  const args = toTimelineArgs({
    due: el<HTMLInputElement>(IDS.due).value,
    order: el<HTMLSelectElement>(IDS.order).value,
    months: el<HTMLSelectElement>(IDS.months).value,
  });
  let r: PageResult;
  try {
    r = computeForPage(args, kstToday(new Date()));
  } catch {
    showError("계산 중 문제가 생겼어요. 입력을 확인하고 다시 시도해 주세요.");
    return;
  }
  if (!r.ok) {
    showError(r.message);
    return;
  }
  el<HTMLElement>(IDS.error).hidden = true;
  el<HTMLElement>(IDS.error).textContent = "";
  el<HTMLElement>(IDS.asOf).textContent = "계산에 쓴 오늘 날짜(한국 시간): " + r.asOf;
  el<HTMLElement>(IDS.cards).replaceChildren(...r.cards.map(cardItem));
  el<HTMLElement>(IDS.raw).textContent = r.text;
  el<HTMLElement>(IDS.result).hidden = false;
}

if (typeof document !== "undefined") {
  el<HTMLButtonElement>(IDS.button).addEventListener("click", run);
}
