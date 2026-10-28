import { CACHE_TTL_MS } from "../core/cache-ttl.js";
import type { ApiSpec } from "./data-go-kr.js";

export type SpecId =
  | "nemcList"
  | "nemcMoonlight"
  | "benefitsList"
  | "durPregnancy"
  | "vaccClinic"
  | "checkupClinic"
  | "kasiHoliday";

const STD_ITEMS = ["response", "body", "items", "item"];
const STD_TOTAL = ["response", "body", "totalCount"];
const STD_CODE = ["response", "header", "resultCode"];

const NEMC_DATASET_URL = "https://www.data.go.kr/data/15000736/openapi.do";
const NEMC_ATTRIBUTION = "국립중앙의료원(공공데이터포털)";
const NEMC_BASE_URL = "https://apis.data.go.kr/B552657/HsptlAsembySearchService";

export const SPECS: Readonly<Record<SpecId, ApiSpec>> = {
  nemcList: {
    id: "nemcList",
    title: "국립중앙의료원 전국 병·의원 찾기 — 병·의원 목록정보 조회",
    datasetUrl: NEMC_DATASET_URL,
    attribution: NEMC_ATTRIBUTION,
    baseUrl: NEMC_BASE_URL,
    operation: "getHsptlMdcncListInfoInqire",
    itemsPath: STD_ITEMS,
    totalCountPath: STD_TOTAL,
    resultCodePath: STD_CODE,
    cacheTtlMs: CACHE_TTL_MS.nightClinic,
    confirmed: true,
    knownParams: ["Q0", "Q1", "QD", "QN", "numOfRows"],
    note: "실응답(2026-10-28)으로 확인. 소아청소년과 코드(QD) 미확인, QT·pageNo·QZ·ORD 미시험, XML 사용(_type=json은 시간 필드 숫자·문자열 혼재, ADR-15)(.docs/api-notes/nemc.md 참조)",
  },
  nemcMoonlight: {
    id: "nemcMoonlight",
    title: "국립중앙의료원 — 달빛어린이병원 및 소아전문센터 목록정보 조회",
    datasetUrl: NEMC_DATASET_URL,
    attribution: NEMC_ATTRIBUTION,
    baseUrl: NEMC_BASE_URL,
    operation: "getBabyListInfoInqire",
    itemsPath: STD_ITEMS,
    totalCountPath: STD_TOTAL,
    resultCodePath: STD_CODE,
    cacheTtlMs: CACHE_TTL_MS.nightClinic,
    confirmed: true,
    knownParams: ["Q0", "Q1", "QN", "numOfRows"],
    note: "실응답(2026-10-28)으로 확인. 달빛 여부 판정 미확인, QT 효과 미확인, XML 사용(_type=json은 시간 필드 숫자·문자열 혼재, ADR-15)(.docs/api-notes/nemc.md 참조)",
  },
  benefitsList: {
    id: "benefitsList",
    title: "행정안전부 대한민국 공공서비스(혜택) 정보",
    datasetUrl: "https://www.data.go.kr/data/15113968/openapi.do",
    attribution: "행정안전부(공공데이터포털)",
    baseUrl: "https://api.odcloud.kr/api/gov24/v3",
    operation: "serviceList",
    itemsPath: ["data"],
    totalCountPath: ["totalCount"],
    resultCodePath: ["code"],
    cacheTtlMs: CACHE_TTL_MS.benefits,
    confirmed: true,
    knownParams: ["page", "perPage"],
    note: "실응답(2026-10-28)으로 목록 확인. odcloud JSON(data 배열·최상위 totalCount, 오류 {code,msg}). cond[…] 서버 필터·serviceDetail 미확인, 조회 방식은 M13(ADR-15, .docs/api-notes/benefits.md 참조)",
  },
  durPregnancy: {
    id: "durPregnancy",
    title: "식약처 DUR 품목정보 — 임부 금기",
    datasetUrl: "https://www.data.go.kr/data/15059486/openapi.do",
    attribution: "식품의약품안전처(공공데이터포털)",
    baseUrl: "https://apis.data.go.kr/1471000/DURPrdlstInfoService03",
    operation: "getPwnmTabooInfoList03",
    itemsPath: STD_ITEMS,
    totalCountPath: STD_TOTAL,
    resultCodePath: STD_CODE,
    cacheTtlMs: CACHE_TTL_MS.dur,
    confirmed: true,
    knownParams: ["itemName"],
    note: "실응답(2026-10-28)으로 확인. _type=json 미적용(XML만 응답), itemName은 성분명 기준(품목명 0건)(.docs/api-notes/dur-pregnancy.md 참조)",
  },
  vaccClinic: {
    id: "vaccClinic",
    title: "예방접종 위탁의료기관",
    datasetUrl: "",
    attribution: "질병관리청",
    baseUrl: "",
    operation: "",
    itemsPath: STD_ITEMS,
    totalCountPath: STD_TOTAL,
    resultCodePath: STD_CODE,
    cacheTtlMs: CACHE_TTL_MS.vaccClinic,
    confirmed: false,
    note: "전국 데이터셋 미확인(C11), M15",
  },
  checkupClinic: {
    id: "checkupClinic",
    title: "건강검진기관",
    datasetUrl: "",
    attribution: "국민건강보험공단",
    baseUrl: "",
    operation: "",
    itemsPath: STD_ITEMS,
    totalCountPath: STD_TOTAL,
    resultCodePath: STD_CODE,
    cacheTtlMs: CACHE_TTL_MS.checkupClinic,
    confirmed: false,
    note: "데이터셋·파라미터 미확인, M15",
  },
  kasiHoliday: {
    id: "kasiHoliday",
    title: "한국천문연구원 특일 정보 — 공휴일",
    datasetUrl: "https://www.data.go.kr/data/15012690/openapi.do",
    attribution: "한국천문연구원(공공데이터포털)",
    baseUrl: "https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService",
    operation: "getRestDeInfo",
    itemsPath: STD_ITEMS,
    totalCountPath: STD_TOTAL,
    resultCodePath: STD_CODE,
    cacheTtlMs: CACHE_TTL_MS.kasiHoliday,
    confirmed: true,
    knownParams: ["solYear", "numOfRows"],
    note: "실응답(2026-10-28)으로 확인. XML 경로 유지(R17), 2029년 빈 응답(.docs/api-notes/kasi-holidays.md 참조)",
  },
};
