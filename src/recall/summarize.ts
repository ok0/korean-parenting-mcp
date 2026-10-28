import type { SkService } from "../clients/safetykorea.js";

export const CHILD_KEYWORDS = ["어린이", "유아", "영유아", "영아", "아동", "키즈", "kids", "베이비", "baby", "아기", "신생아", "완구", "장난감", "유모차", "카시트", "보행기", "젖병", "기저귀"] as const;
export const SERVICE_ORDER: readonly SkService[] = ["recallList", "fRecallList", "overseasList", "certificationList"];
export const SOURCE_LABEL: Readonly<Record<SkService, string>> = { recallList: "국내 리콜", fRecallList: "국외 리콜", overseasList: "해외직구 안전성조사", certificationList: "KC 인증" };

export interface RecallRow {
  service: SkService; key: string; uid?: string;
  product?: string; model?: string; brand?: string; company?: string; country?: string;
  date?: string;
  kind?: string; publisher?: string; reason?: string; action?: string;
  contact?: string; url?: string; certState?: string;
  child: boolean;
}

function s(v: unknown): string | undefined {
  if (typeof v !== "string" && typeof v !== "number") return undefined;
  const t = String(v).replace(/\s+/g, " ").trim();
  return t === "" || t === "-" ? undefined : t;
}

function ymd(v: unknown): string | undefined {
  const t = s(v);
  if (t === undefined) return undefined;
  if (/^\d{8}$/.test(t)) return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  return undefined;
}

function joinDefined(parts: readonly (string | undefined)[], sep: string): string | undefined {
  const defined = parts.filter((p): p is string => p !== undefined);
  return defined.length === 0 ? undefined : defined.join(sep);
}

export function isChildText(texts: readonly (string | undefined)[]): boolean {
  const joined = texts.filter((t): t is string => t !== undefined).join("\n").normalize("NFKC").toLowerCase();
  return CHILD_KEYWORDS.some((k) => joined.includes(k));
}

export function toRecallRow(service: SkService, item: Record<string, unknown>): RecallRow {
  const g = (k: string) => s(item[k]);
  let row: Omit<RecallRow, "key" | "child">;
  let childTexts: (string | undefined)[];
  switch (service) {
    case "recallList": {
      const product = g("recallProductName");
      const model = g("recallModelName");
      row = {
        service, uid: g("recallUid"), product, model,
        brand: g("recallBrandName"), company: g("recallCmpnyName"), country: g("makingCntryName"),
        date: ymd(item.publishDate), kind: g("recallTypeName"), action: g("publishActionDscr"), contact: g("recallInqryTel"),
      };
      childTexts = [product, model, g("productItemName"), g("categoryName")];
      break;
    }
    case "fRecallList": {
      const product = g("recallProductName");
      const model = g("recallModelName");
      const reason = g("violateDscr");
      row = {
        service, uid: g("fRecallUid"), product, model,
        brand: g("recallBrandName"), company: g("makerName"), country: g("makingCntryName"),
        date: ymd(item.publishDate), kind: g("recallTypeName"),
        publisher: joinDefined([g("recallPblshCntryName"), g("recallPblshOrgnName")], " · "),
        reason, action: g("publishActionDscr"), url: g("recallUrl"),
      };
      childTexts = [product, model, reason];
      break;
    }
    case "overseasList": {
      const product = g("productName");
      const model = g("modelName");
      const reason = joinDefined([g("harmDscr"), g("accidentCaseDscr")], " / ");
      row = {
        service, uid: g("overseasUid"), product, model,
        brand: g("brandName"), country: g("makingCntryName"), date: ymd(item.publishDate), reason,
      };
      childTexts = [product, model, reason];
      break;
    }
    case "certificationList": {
      const product = g("productName");
      const model = g("modelName");
      const kind = g("certDiv");
      row = {
        service, uid: g("certUid"), product, model,
        brand: g("brandName"), company: g("makerName"), country: g("makerCntryName"),
        date: ymd(item.certDate), kind, certState: g("certState"),
      };
      childTexts = [product, model, g("categoryName"), kind];
      break;
    }
  }
  const key = row.uid !== undefined ? `${service}#${row.uid}` : `${service}|${row.product ?? ""}|${row.date ?? ""}`;
  return { ...row, key, child: isChildText(childTexts) };
}

export function dedupeRows(rows: readonly RecallRow[]): RecallRow[] {
  const seen = new Set<string>();
  const out: RecallRow[] = [];
  for (const r of rows) {
    if (seen.has(r.key)) continue;
    seen.add(r.key);
    out.push(r);
  }
  return out;
}

export function compareRows(a: RecallRow, b: RecallRow): number {
  if (a.date !== b.date) {
    if (a.date === undefined) return 1;
    if (b.date === undefined) return -1;
    return a.date > b.date ? -1 : 1;
  }
  const sa = SERVICE_ORDER.indexOf(a.service);
  const sb = SERVICE_ORDER.indexOf(b.service);
  if (sa !== sb) return sa - sb;
  if (a.key < b.key) return -1;
  if (a.key > b.key) return 1;
  return 0;
}
