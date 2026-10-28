const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const CACHE_TTL_MS = {
  benefits: DAY,
  dur: 7 * DAY,
  kindergarten: DAY,
  recall: DAY,
  vaccClinic: DAY,
  checkupClinic: DAY,
  lawRevision: DAY,
  lawArticle: DAY,
  kasiHoliday: DAY,
  nightClinic: 0,
} as const;

export type CacheTtlName = keyof typeof CACHE_TTL_MS;
