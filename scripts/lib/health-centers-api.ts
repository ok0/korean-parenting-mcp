import { HeaderError, type SourceRow } from "./health-centers-csv.js";

export const API_ENDPOINT =
  "https://api.data.go.kr/openapi/tn_pubr_public_ht_inst_api";
export const API_FILE_NAME = "tn_pubr_public_ht_inst_api";
export const MANIFEST_FILE = "manifest.json";
export const PAGE_FILE_RE = /^page-(\d{4})\.json$/;

export function pageFileName(n: number): string {
  return `page-${String(n).padStart(4, "0")}.json`;
}

export const API_FIELD_MAP = {
  name: "htInstNm",
  sido: "ctpvNm",
  sigungu: "sggNm",
  kind: "htctTypeNm",
  roadAddress: "lctnRoadNmAddr",
  lotAddress: "lctnLotnoAddr",
  homepage: "hmpgAddr",
  phone: "telno",
} as const;

export const OPTIONAL_API_FIELD_MAP = { dataDate: "crtrYmd" } as const;
// mcareExmdCn(진료검진내용)은 사업 제공 여부를 단정하지 않기 위해 읽지 않는다(R87).

export class ApiPageError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiPageError";
  }
}

export interface ApiPage {
  resultCode: string;
  resultMsg: string;
  totalCount: number;
  pageNo: number;
  numOfRows: number;
  items: Record<string, unknown>[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toCount(value: unknown): number {
  const n = Number(value);
  return Number.isNaN(n) ? 0 : n;
}

export function parseApiPage(text: string): ApiPage {
  const t = text.trim();

  if (t.startsWith("<")) {
    const code =
      /<(?:returnReasonCode|resultCode)>([^<]*)</.exec(t)?.[1] ?? "XML";
    const pick = (tag: string) =>
      new RegExp(`<${tag}>([^<]*)<`).exec(t)?.[1];
    const msg =
      pick("returnAuthMsg") ?? pick("resultMsg") ?? pick("errMsg") ?? "";
    throw new ApiPageError(
      code,
      `공공데이터포털이 XML 오류 응답을 보냈어요: ${code} ${msg}`.trim(),
    );
  }

  let obj: unknown;
  try {
    obj = JSON.parse(t);
  } catch {
    throw new ApiPageError(
      "PARSE",
      `응답을 JSON으로 읽지 못했어요(앞부분: ${t.slice(0, 80)})`,
    );
  }

  const response = isObject(obj) ? obj.response : undefined;
  const header = isObject(response) ? response.header : undefined;
  if (!isObject(header)) {
    throw new ApiPageError("SHAPE", "응답에서 response.header를 찾지 못했어요");
  }
  const resultCode = String(header.resultCode ?? "");
  const resultMsg = String(header.resultMsg ?? "");

  if (resultCode === "03") {
    return {
      resultCode,
      resultMsg,
      totalCount: 0,
      pageNo: 0,
      numOfRows: 0,
      items: [],
    };
  }
  if (resultCode !== "00") {
    throw new ApiPageError(
      resultCode,
      `응답 코드 ${resultCode}(${resultMsg})` +
        (resultCode === "22"
          ? " · 일일 호출 한도를 넘었어요. 내일 다시 실행하세요"
          : ""),
    );
  }

  const body = isObject(response) ? response.body : undefined;
  if (!isObject(body)) {
    throw new ApiPageError("SHAPE", "응답에서 response.body를 찾지 못했어요");
  }

  const itemsValue = body.items;
  let raw: unknown[];
  if (Array.isArray(itemsValue)) {
    raw = itemsValue;
  } else if (isObject(itemsValue) && Array.isArray(itemsValue.item)) {
    raw = itemsValue.item;
  } else if (isObject(itemsValue) && isObject(itemsValue.item)) {
    raw = [itemsValue.item];
  } else if (
    itemsValue === undefined ||
    itemsValue === null ||
    itemsValue === ""
  ) {
    raw = [];
  } else {
    throw new ApiPageError("SHAPE", "응답의 body.items 형태를 확인하세요");
  }

  if (!raw.every(isObject)) {
    throw new ApiPageError("SHAPE", "응답 항목 형태를 확인하세요");
  }

  const totalCount = Number(body.totalCount);
  if (!Number.isInteger(totalCount) || totalCount < 0) {
    throw new ApiPageError("SHAPE", "응답의 totalCount를 확인하세요");
  }

  return {
    resultCode,
    resultMsg,
    totalCount,
    pageNo: toCount(body.pageNo ?? 0),
    numOfRows: toCount(body.numOfRows ?? 0),
    items: raw,
  };
}

export interface ApiManifest {
  dataset_id: "15107750";
  endpoint: string;
  fetched_at: string;
  num_of_rows: number;
  total_count: number;
  pages: number;
  items: number;
  complete: boolean;
}

export function parseApiManifest(text: string): ApiManifest {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new ApiPageError("MANIFEST", "manifest.json을 읽지 못했어요");
  }
  const m = isObject(obj) ? obj : {};
  const isCount = (value: unknown): boolean =>
    typeof value === "number" && Number.isInteger(value) && value >= 0;

  const checks: [string, boolean][] = [
    ["dataset_id", m.dataset_id === "15107750"],
    ["endpoint", typeof m.endpoint === "string"],
    ["fetched_at", typeof m.fetched_at === "string"],
    ["num_of_rows", isCount(m.num_of_rows)],
    ["total_count", isCount(m.total_count)],
    ["pages", isCount(m.pages)],
    ["items", isCount(m.items)],
    ["complete", typeof m.complete === "boolean"],
  ];
  for (const [field, ok] of checks) {
    if (!ok)
      throw new ApiPageError(
        "MANIFEST",
        `manifest.json 형식을 확인하세요(${field})`,
      );
  }

  return {
    dataset_id: "15107750",
    endpoint: m.endpoint as string,
    fetched_at: m.fetched_at as string,
    num_of_rows: m.num_of_rows as number,
    total_count: m.total_count as number,
    pages: m.pages as number,
    items: m.items as number,
    complete: m.complete as boolean,
  };
}

export function apiItemsToSourceRows(
  items: readonly Record<string, unknown>[],
): SourceRow[] {
  if (items.length === 0) return [];

  const found = Object.keys(items[0] ?? {});
  const missing = Object.values(API_FIELD_MAP).filter(
    (name) => !found.includes(name),
  );
  if (missing.length > 0) throw new HeaderError(missing, found);

  const cellOf = (value: unknown): string =>
    value === undefined || value === null
      ? ""
      : String(value).normalize("NFKC").trim();

  return items.map((item, i) => ({
    row: i + 1,
    name: cellOf(item[API_FIELD_MAP.name]),
    sido: cellOf(item[API_FIELD_MAP.sido]),
    sigungu: cellOf(item[API_FIELD_MAP.sigungu]),
    kind: cellOf(item[API_FIELD_MAP.kind]),
    roadAddress: cellOf(item[API_FIELD_MAP.roadAddress]),
    lotAddress: cellOf(item[API_FIELD_MAP.lotAddress]),
    homepage: cellOf(item[API_FIELD_MAP.homepage]),
    phone: cellOf(item[API_FIELD_MAP.phone]),
    dataDate: cellOf(item[OPTIONAL_API_FIELD_MAP.dataDate]),
  }));
}
