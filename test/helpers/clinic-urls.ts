/** R5: research에서 관측된 공식 주소만(clinic-apis C11/S2, checkup-vaccination-originals S8, nhis 대표 주소). */
export const OBSERVED_CLINIC_URLS = {
  vaccination: ["https://nip.kdca.go.kr/irhp/mngm/goVcntMngm.do?menuCd=336&menuLv=3", "https://nip.kdca.go.kr/irhp/infm/goVcntInfo.do?menuLv=1&menuCd=115", "https://nip.kdca.go.kr"],
  checkup: ["https://www.nhis.or.kr/"],
} as const;

export const URL_RE = /https?:\/\/[^\s)]+/g;
