import type { HealthCenterEntry } from "../../src/data-store/schema.js";

export interface HealthCenterCorrection {
  code: string;
  name: string;
  field: "phone";
  from: string;
  to: string;
  source_url: string;
  checked_on: string;
  verified_by: string;
}

const CHECKED_ON = "2026-11-04";

export const HEALTH_CENTER_CORRECTIONS: readonly HealthCenterCorrection[] = [
  // 보건소 소개 페이지 표기 전화번호(구청 대표·120 다산콜센터 연결)
  { code: "11440", name: "마포구보건소", field: "phone", from: "02-3153-9114", to: "02-3153-8114", source_url: "https://www.mapo.go.kr/site/health/content/health010401", checked_on: CHECKED_ON, verified_by: "agent web check (mapo.go.kr)" },
  // 보건소 페이지 게시 번호(TEL 061-531-3738, 3739)
  { code: "12790", name: "해남군보건소", field: "phone", from: "061-531-3713", to: "061-531-3738", source_url: "http://www.haenam.go.kr/health/index.9is?contentUid=18e3368f6797832401681169c3cf5d94", checked_on: CHECKED_ON, verified_by: "agent web check (haenam.go.kr)" },
  // 모자보건(임산부) 표기 번호
  { code: "41117", name: "영통구보건소", field: "phone", from: "031-5191-0718", to: "031-5191-0778", source_url: "https://health.suwon.go.kr/sub.asp?page_code=sub010103", checked_on: CHECKED_ON, verified_by: "agent web check (health.suwon.go.kr)" },
];

export function applyCorrections(
  entries: readonly HealthCenterEntry[],
  corrections: readonly HealthCenterCorrection[],
): { entries: HealthCenterEntry[]; applied: string[]; stale: string[] } {
  const out: HealthCenterEntry[] = entries.slice();
  const applied: string[] = [];
  const stale: string[] = [];
  for (const c of corrections) {
    const key = `${c.code}|${c.name}`;
    const idx: number[] = [];
    out.forEach((e, i) => {
      if (e.code === c.code && e.name === c.name) idx.push(i);
    });
    if (idx.length === 0) {
      stale.push(`${key} ${c.field}: 목록에서 항목을 찾지 못했어요(정정 전 값 ${c.from})`);
      continue;
    }
    const hits = idx.filter((i) => out[i]?.[c.field] === c.from);
    if (hits.length === 0) {
      stale.push(`${key} ${c.field}: 현재 값 ${idx.map((i) => out[i]?.[c.field] ?? "없음").join(", ")}, 정정 전 값 ${c.from}`);
      continue;
    }
    for (const i of hits) {
      const current = out[i];
      if (current === undefined) continue;
      out[i] = { ...current, [c.field]: c.to, verified: "full", verified_by: c.verified_by, verified_on: c.checked_on };
      applied.push(`${key} ${c.field}: ${c.from} → ${c.to}`);
    }
  }
  return { entries: out, applied, stale };
}
