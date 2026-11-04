import { ToolError } from "../../src/core/tool-error.js";
import { formatDate, todayKst, type CivilDate } from "../../src/date/civil-date.js";
import type { TimelineArgs } from "../../src/timeline/input.js";
import { computeOfflineTimeline } from "../../src/timeline/offline.js";
import { provenanceDocs } from "../../src/timeline/render.js";
import type { Category, Nature, Status } from "../../src/timeline/types.js";

export interface PageSource { title: string; url: string; asOf: string; }

export interface PageCard {
  date: string;
  end: string | null;
  title: string;
  category: Category;
  nature: Nature;
  status: Status | null;
  sources: PageSource[];
}

export type PageResult =
  | { ok: true; text: string; cards: PageCard[]; asOf: string }
  | { ok: false; message: string };

export function kstToday(now: Date): CivilDate {
  return todayKst({ now: () => now });
}

export function computeForPage(args: TimelineArgs, today: CivilDate): PageResult {
  let output;
  let items;
  try {
    const computed = computeOfflineTimeline(args, today);
    output = computed.output;
    items = computed.result.items;
  } catch (e) {
    if (e instanceof ToolError) {
      return { ok: false, message: e.message };
    }
    throw e;
  }
  const { body, footer } = output;
  const text = footer ? body + "\n\n" + footer : body;
  const cards: PageCard[] = items.map((i) => ({
    date: formatDate(i.start),
    end: i.end ? formatDate(i.end) : null,
    title: i.title,
    category: i.category,
    nature: i.nature,
    status: i.status ?? null,
    sources: provenanceDocs(i.provenance).map((d) => ({ title: d.title, url: d.url, asOf: d.as_of })),
  }));
  return { ok: true, text, cards, asOf: formatDate(today) };
}
