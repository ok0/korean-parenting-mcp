export const REMOTE_TEST_ENV: Readonly<Record<string, string>> = {
  KPM_OPERATOR_CONTACT: "operator-contact-sentinel@example.com",
  KPM_HOST_PROVIDER: "host-provider-sentinel",
  KPM_HOST_COUNTRY: "KR",
  KPM_HOST_REGION: "host-region-sentinel",
  KPM_HOST_LOG_RETENTION: "log-retention-sentinel-30d",
  KPM_HOST_REQUEST_LOGS: "excluded",
};
export const REQUIRED_REMOTE_ENV = ["KPM_OPERATOR_CONTACT", "KPM_HOST_PROVIDER", "KPM_HOST_COUNTRY", "KPM_HOST_REGION", "KPM_HOST_LOG_RETENTION", "KPM_HOST_REQUEST_LOGS"] as const;
