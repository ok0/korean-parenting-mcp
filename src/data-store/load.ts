import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  BasisDocumentsSchema,
  BenefitsSchema,
  CheckupsSchema,
  DaycareGuideSchema,
  DeadlinesSchema,
  HolidaysSchema,
  LeaveSchema,
  LocalGuidanceSchema,
  PrenatalSchema,
  RegionsSchema,
  VaccinationsSchema,
  type BasisDoc,
  type BasisDocuments,
  type BenefitsFile,
  type CheckupsFile,
  type DaycareGuideFile,
  type DeadlinesFile,
  type HolidaysFile,
  type LeaveFile,
  type LocalGuidanceFile,
  type PrenatalFile,
  type RegionsFile,
  type VaccinationsFile,
} from "./schema.js";

export type DatasetName =
  | "basis-documents"
  | "holidays"
  | "deadlines"
  | "checkups"
  | "vaccinations"
  | "prenatal"
  | "benefits"
  | "leave"
  | "local-guidance"
  | "regions"
  | "daycare-guide";

export interface DatasetMap {
  "basis-documents": BasisDocuments;
  holidays: HolidaysFile;
  deadlines: DeadlinesFile;
  checkups: CheckupsFile;
  vaccinations: VaccinationsFile;
  prenatal: PrenatalFile;
  benefits: BenefitsFile;
  leave: LeaveFile;
  "local-guidance": LocalGuidanceFile;
  regions: RegionsFile;
  "daycare-guide": DaycareGuideFile;
}

const SCHEMAS = {
  "basis-documents": BasisDocumentsSchema,
  holidays: HolidaysSchema,
  deadlines: DeadlinesSchema,
  checkups: CheckupsSchema,
  vaccinations: VaccinationsSchema,
  prenatal: PrenatalSchema,
  benefits: BenefitsSchema,
  leave: LeaveSchema,
  "local-guidance": LocalGuidanceSchema,
  regions: RegionsSchema,
  "daycare-guide": DaycareGuideSchema,
} as const;

export class DataValidationError extends Error {
  readonly dataset: string;
  readonly issues: string[];

  constructor(dataset: string, issues: string[]) {
    super(`데이터 파일 검증 실패 (${dataset}.json):\n- ${issues.join("\n- ")}`);
    this.name = "DataValidationError";
    this.dataset = dataset;
    this.issues = issues;
  }
}

export function collectBasisIds(value: unknown): string[] {
  const seen = new Set<string>();
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const item of v) walk(item);
      return;
    }
    if (typeof v === "object" && v !== null) {
      for (const [key, child] of Object.entries(v)) {
        if (key === "basis_ids" && Array.isArray(child) && child.every((x) => typeof x === "string")) {
          for (const id of child as string[]) seen.add(id);
        } else {
          walk(child);
        }
      }
    }
  };
  walk(value);
  return [...seen];
}

export function validateDataset<K extends DatasetName>(
  name: K,
  raw: unknown,
  basis?: BasisDocuments,
): DatasetMap[K] {
  const schema: z.ZodType = SCHEMAS[name];
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new DataValidationError(
      name,
      result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    );
  }
  const parsed = result.data as DatasetMap[K];
  if (name !== "basis-documents") {
    if (!basis) {
      throw new Error("근거 문서 목록(basis-documents)이 필요합니다");
    }
    const known = new Set(basis.documents.map((d) => d.id));
    const issues = collectBasisIds(parsed)
      .filter((id) => !known.has(id))
      .map((id) => `basis_ids: 알 수 없는 근거 문서 id "${id}"`);
    if (issues.length > 0) {
      throw new DataValidationError(name, issues);
    }
  }
  return parsed;
}

export function findDataDir(fromUrl: string | URL = import.meta.url, maxUp = 3): string {
  const start = fileURLToPath(fromUrl);
  let dir = dirname(start);
  for (let i = 0; i <= maxUp; i++) {
    if (existsSync(join(dir, "data", "basis-documents.json"))) {
      return join(dir, "data");
    }
    dir = dirname(dir);
  }
  throw new Error(`데이터 디렉터리(data/)를 찾을 수 없습니다: ${start} 기준 ${maxUp}단계 상위까지 확인`);
}

export function readDataset<K extends DatasetName>(dir: string, name: K, basis?: BasisDocuments): DatasetMap[K] {
  const text = readFileSync(join(dir, `${name}.json`), "utf8");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new DataValidationError(name, [`JSON 구문 오류: ${msg}`]);
  }
  let resolvedBasis = basis;
  if (name !== "basis-documents" && resolvedBasis === undefined) {
    resolvedBasis = readDataset(dir, "basis-documents");
  }
  return validateDataset(name, raw, resolvedBasis);
}

let dataDir: string | undefined;
const memo = new Map<DatasetName, unknown>();

export function loadData<K extends DatasetName>(name: K): DatasetMap[K] {
  const cached = memo.get(name);
  if (cached !== undefined) {
    return cached as DatasetMap[K];
  }
  dataDir ??= findDataDir();
  const value = readDataset(dataDir, name, name === "basis-documents" ? undefined : loadData("basis-documents"));
  memo.set(name, value);
  return value;
}

export function resolveBasis(ids: readonly string[]): BasisDoc[] {
  const documents = loadData("basis-documents").documents;
  return ids.map((id) => {
    const doc = documents.find((d) => d.id === id);
    if (!doc) {
      throw new Error(`알 수 없는 근거 문서 id: ${id}`);
    }
    return doc;
  });
}
