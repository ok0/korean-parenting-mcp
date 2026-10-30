import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DataValidationError, makeDataStore, validateDataset, type DatasetMap, type DatasetName } from "./validate.js";
import type { BasisDoc, BasisDocuments } from "./schema.js";
export { collectBasisIds, DataValidationError, validateDataset, type DatasetMap, type DatasetName } from "./validate.js";

function parseDatasetText(name: DatasetName, text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new DataValidationError(name, [`JSON 구문 오류: ${msg}`]);
  }
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
  const raw = parseDatasetText(name, readFileSync(join(dir, `${name}.json`), "utf8"));
  let resolvedBasis = basis;
  if (name !== "basis-documents" && resolvedBasis === undefined) {
    resolvedBasis = readDataset(dir, "basis-documents");
  }
  return validateDataset(name, raw, resolvedBasis);
}

let dataDir: string | undefined;
const store = makeDataStore((name) => {
  dataDir ??= findDataDir();
  return parseDatasetText(name, readFileSync(join(dataDir, `${name}.json`), "utf8"));
});

export function loadData<K extends DatasetName>(name: K): DatasetMap[K] {
  return store.loadData(name);
}

export function resolveBasis(ids: readonly string[]): BasisDoc[] {
  return store.resolveBasis(ids);
}
