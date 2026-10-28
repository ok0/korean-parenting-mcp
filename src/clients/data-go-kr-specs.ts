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
    knownParams: ["Q0", "Q1", "QZ", "QD", "QT", "QN", "ORD", "pageNo", "numOfRows"],
    note: "서비스 URL·오퍼레이션·요청변수는 research/data-go-kr-apis.md C1·C2. 응답 경로(itemsPath 등)는 포털 표준 구조 가정, M11 실응답으로 확인",
  },
  nemcMoonlight: {
    id: "nemcMoonlight",
    title: "국립중앙의료원 — 달빛어린이병원 및 소아전문센터 목록정보 조회",
    datasetUrl: NEMC_DATASET_URL,
    attribution: NEMC_ATTRIBUTION,
    baseUrl: NEMC_BASE_URL,
    operation: "",
    itemsPath: STD_ITEMS,
    totalCountPath: STD_TOTAL,
    resultCodePath: STD_CODE,
    cacheTtlMs: CACHE_TTL_MS.nightClinic,
    confirmed: false,
    note: "오퍼레이션 URL 미확인(C1), M11",
  },
  benefitsList: {
    id: "benefitsList",
    title: "행정안전부 대한민국 공공서비스(혜택) 정보",
    datasetUrl: "https://www.data.go.kr/data/15113968/openapi.do",
    attribution: "행정안전부(공공데이터포털)",
    baseUrl: "",
    operation: "",
    itemsPath: STD_ITEMS,
    totalCountPath: STD_TOTAL,
    resultCodePath: STD_CODE,
    cacheTtlMs: CACHE_TTL_MS.benefits,
    confirmed: false,
    note: "엔드포인트·파라미터 미확인(C6), M11",
  },
  durPregnancy: {
    id: "durPregnancy",
    title: "식약처 DUR 품목정보 — 임부 금기",
    datasetUrl: "https://www.data.go.kr/data/15059486/openapi.do",
    attribution: "식품의약품안전처(공공데이터포털)",
    baseUrl: "",
    operation: "",
    itemsPath: STD_ITEMS,
    totalCountPath: STD_TOTAL,
    resultCodePath: STD_CODE,
    cacheTtlMs: CACHE_TTL_MS.dur,
    confirmed: false,
    note: "임부금기 오퍼레이션·등급 필드 미확인(C7), M11",
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
    confirmed: false,
    knownParams: ["solYear", "solMonth", "pageNo", "numOfRows"],
    note: "오퍼레이션명 2차 자료(research/legal-dates-holidays.md C13), JSON 여부 미확인(C15), M11",
  },
};
