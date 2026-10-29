import { loadRemoteConfig } from "../../src/remote/remote-config.js";
import { REMOTE_TEST_ENV } from "./remote-env.js";

export const REMOTE_SECRET_ENV = ["DATA_GO_KR_SERVICE_KEY", "KINDERGARTEN_API_KEY", "LAW_OC", "SAFETYKOREA_AUTH_KEY", "KPM_REMOTE_BEARER_TOKEN", "KPM_ALERT_WEBHOOK_URL"] as const;

export function remoteEnvReads(): string[] {
  const seen = new Set<string>();
  const env = new Proxy({ ...REMOTE_TEST_ENV } as Record<string, string | undefined>, {
    get(t, p, r) {
      if (typeof p === "string") seen.add(p);
      return Reflect.get(t, p, r);
    },
    has(t, p) {
      if (typeof p === "string") seen.add(p);
      return Reflect.has(t, p);
    },
  });
  loadRemoteConfig(env);
  return [...seen].filter((n) => /^[A-Z][A-Z0-9_]*$/.test(n)).sort();
}
