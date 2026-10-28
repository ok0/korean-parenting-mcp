import { loadData } from "../data-store/load.js";
import type { ClinicLinkEntry, ClinicToolGuide } from "../data-store/schema.js";
import type { Region } from "../region/normalize.js";

export type ClinicLink = ClinicLinkEntry;
export type ClinicTool = "vaccination" | "checkup";

export interface ClinicLinkQuery {
  region?: Region;
  stage: "birth" | "due" | "none";
  months?: number;
}

/** 링크 목록의 단일 경계(도구별 1개). 이후 API 기반 구현(예: 검진기관 찾기 조회 클라이언트)이 이 인터페이스만 대체한다. */
export interface ClinicLinkProvider {
  links(input: ClinicLinkQuery): readonly ClinicLink[];
}

export const staticVaccinationLinkProvider: ClinicLinkProvider = {
  links: () => loadData("clinic-guide").vaccination.links,
};

export const staticCheckupLinkProvider: ClinicLinkProvider = {
  links: () => loadData("clinic-guide").checkup.links,
};

export type ClinicToolGuideContent = Omit<ClinicToolGuide, "links">;

export function clinicGuideContent(tool: ClinicTool): { as_of: string; guide: ClinicToolGuideContent } {
  const f = loadData("clinic-guide");
  const { links: _links, ...rest } = f[tool];
  return { as_of: f.as_of, guide: { ...rest } };
}
