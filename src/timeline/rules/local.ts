import { loadData } from "../../data-store/load.js";
import type { TimelineInput, LocalGuidanceLine, LocalGuidanceSection } from "../types.js";
import { lookupHealthCenter, type HealthCenterLookup } from "../../region/health-centers.js";
import { pickProvenance } from "./common.js";

export function localGuidance(
  input: Pick<TimelineInput, "mode" | "region">,
  data = loadData("local-guidance"),
  lookup: (regionText: string) => HealthCenterLookup = lookupHealthCenter,
): LocalGuidanceSection {
  const mode = input.mode ?? "born";
  const entries = data.entries.filter((e) => e.modes.includes(mode));
  const lines: LocalGuidanceLine[] = entries.map((e) => ({
    id: e.id,
    title: e.title,
    text: e.guidance.join(" "),
    contact: input.region !== undefined ? e.contact_template.replaceAll("{region}", input.region) : e.contact_default,
    url: e.url,
    provenance: pickProvenance(e),
  }));
  const basisIds = [...new Set(lines.flatMap((l) => l.provenance.basis_ids))];
  const healthCenter = input.region !== undefined && input.region.trim() !== "" ? lookup(input.region) : undefined;
  if (healthCenter?.kind === "found" && !basisIds.includes(healthCenter.basisId)) {
    basisIds.push(healthCenter.basisId);
  }
  return {
    title: data.section_title,
    region: input.region,
    missingNote: input.region === undefined ? data.region_missing_note : undefined,
    lines,
    basisIds,
    ...(healthCenter !== undefined ? { healthCenter } : {}),
  };
}
