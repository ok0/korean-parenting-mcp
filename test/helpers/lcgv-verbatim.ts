import { healthCenterLine, type HealthCenterLookup } from "../../src/region/health-centers.js";
import { quote, toLcgvDetail, toLcgvRow } from "../../src/local-support/summarize.js";
import { lcgvDetailItem, type LcgvMock } from "./lcgv-mock.js";

export function lcgvDetailItemFor(id: string): Record<string, unknown> {
  if (id === "WLF00003366") return lcgvDetailItem("lcgvDetail/amount.xml");
  if (id === "WLF00004358") return lcgvDetailItem("lcgvDetail/mapo-life007.xml");
  return { servId: id, servNm: `합성 상세 ${id}`, sprtTrgtCn: "합성 지원 대상", lastModYmd: "20261001" };
}

export function lcgvDetailItemsOf(mock: LcgvMock): Record<string, unknown>[] {
  return mock.details().map((u) => lcgvDetailItemFor(u.searchParams.get("servId") ?? ""));
}

export function lcgvVerbatims(
  listItems: Record<string, unknown>[],
  detailItems: Record<string, unknown>[],
  hc?: HealthCenterLookup,
): string[] {
  const out: (string | undefined)[] = [];
  for (const item of listItems) {
    const r = toLcgvRow(item);
    if (r === undefined) continue;
    out.push(r.name, r.dept, r.cycle, r.provision, r.applyMethod, r.sgg, r.link, quote(r.digest));
  }
  for (const item of detailItems) {
    const d = toLcgvDetail(item);
    out.push(quote(d.target), quote(d.content), quote(d.criteria), quote(d.applyText));
    for (const c of d.contacts) {
      out.push(c.name);
      if (c.value !== undefined) out.push(c.value, `${c.name} ${c.value}`);
    }
    out.push(...d.laws);
  }
  if (hc !== undefined && hc.kind === "found") {
    for (const c of hc.centers) out.push(healthCenterLine(c));
  }
  return out.filter((x): x is string => x !== undefined && x !== "");
}
