import basisDocuments from "../../data/basis-documents.json" with { type: "json" };
import holidays from "../../data/holidays.json" with { type: "json" };
import deadlines from "../../data/deadlines.json" with { type: "json" };
import checkups from "../../data/checkups.json" with { type: "json" };
import vaccinations from "../../data/vaccinations.json" with { type: "json" };
import prenatal from "../../data/prenatal.json" with { type: "json" };
import benefits from "../../data/benefits.json" with { type: "json" };
import leave from "../../data/leave.json" with { type: "json" };
import localGuidance from "../../data/local-guidance.json" with { type: "json" };
import regions from "../../data/regions.json" with { type: "json" };
import daycareGuide from "../../data/daycare-guide.json" with { type: "json" };
import clinicGuide from "../../data/clinic-guide.json" with { type: "json" };
import healthCenters from "../../data/health-centers.json" with { type: "json" };
import { makeDataStore, type DatasetMap, type DatasetName } from "../../src/data-store/validate.js";
import type { BasisDoc } from "../../src/data-store/schema.js";

const RAW: Record<DatasetName, unknown> = {
  "basis-documents": basisDocuments,
  holidays,
  deadlines,
  checkups,
  vaccinations,
  prenatal,
  benefits,
  leave,
  "local-guidance": localGuidance,
  regions,
  "daycare-guide": daycareGuide,
  "clinic-guide": clinicGuide,
  "health-centers": healthCenters,
};

const store = makeDataStore((name) => RAW[name]);

export function loadData<K extends DatasetName>(name: K): DatasetMap[K] {
  return store.loadData(name);
}

export function resolveBasis(ids: readonly string[]): BasisDoc[] {
  return store.resolveBasis(ids);
}

export { collectBasisIds, DataValidationError, validateDataset, type DatasetMap, type DatasetName } from "../../src/data-store/validate.js";
