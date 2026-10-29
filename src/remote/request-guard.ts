import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import type { RemoteConfig } from "./remote-config.js";

export type Route = "mcp" | "healthz" | "privacy" | "landing";
export type GuardReason = "query" | "host" | "origin" | "auth" | "path" | "method" | "type";
export type GuardResult =
  | { ok: true; route: Route; originReport?: true }
  | { ok: false; status: 400 | 401 | 403 | 404 | 405 | 415; reason: GuardReason; allow?: string };
export type GuardConfig = Pick<RemoteConfig, "allowedHosts" | "allowedOrigins" | "bearerToken" | "originPolicy" | "getMode">;

export function normalizeHost(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const s = raw.trim().toLowerCase();
  if (s.startsWith("[")) {
    const end = s.indexOf("]");
    return end === -1 ? s : s.slice(0, end + 1);
  }
  const colon = s.indexOf(":");
  return colon === -1 ? s : s.slice(0, colon);
}

function sha256(s: string): Buffer {
  return createHash("sha256").update(s, "utf8").digest();
}

export function checkRequest(
  req: { method?: string; url?: string; headers: IncomingHttpHeaders },
  rc: GuardConfig,
): GuardResult {
  const url = req.url ?? "/";
  const path = url.split("?")[0];
  const method = (req.method ?? "GET").toUpperCase();
  const accept = String(req.headers.accept ?? "");

  let route: Route;
  if (path === "/mcp") {
    if (method === "POST") {
      route = "mcp";
    } else if (method === "GET") {
      if (rc.getMode === "405") return { ok: false, status: 405, reason: "method", allow: "POST" };
      if (!accept.includes("text/event-stream")) {
        return { ok: false, status: 405, reason: "method", allow: "GET, POST" };
      }
      route = "mcp";
    } else {
      return { ok: false, status: 405, reason: "method", allow: rc.getMode === "sse" ? "GET, POST" : "POST" };
    }
  } else if (path === "/healthz") {
    if (method !== "GET" && method !== "HEAD") {
      return { ok: false, status: 405, reason: "method", allow: "GET" };
    }
    route = "healthz";
  } else {
    return { ok: false, status: 404, reason: "path" };
  }

  if (url.includes("?")) return { ok: false, status: 400, reason: "query" };

  const host = normalizeHost(req.headers.host);
  if (host === undefined || !rc.allowedHosts.includes(host)) {
    return { ok: false, status: 403, reason: "host" };
  }

  let originReport = false;
  const origin = req.headers.origin;
  if (typeof origin === "string") {
    const normalized = origin.toLowerCase().replace(/\/+$/, "");
    if (!rc.allowedOrigins.includes(normalized)) {
      if (rc.originPolicy === "strict") return { ok: false, status: 403, reason: "origin" };
      originReport = true;
    }
  }

  if (route === "mcp" && rc.bearerToken !== undefined) {
    const authorization = typeof req.headers.authorization === "string" ? req.headers.authorization : "";
    const match = /^Bearer\s+(.+)$/i.exec(authorization);
    if (match === null) return { ok: false, status: 401, reason: "auth" };
    if (!timingSafeEqual(sha256(match[1] ?? ""), sha256(rc.bearerToken))) {
      return { ok: false, status: 401, reason: "auth" };
    }
  }

  if (route === "mcp" && method === "POST") {
    const mediaType = (String(req.headers["content-type"] ?? "").split(";")[0] ?? "").trim().toLowerCase();
    if (mediaType !== "application/json") return { ok: false, status: 415, reason: "type" };
  }

  return { ok: true, route, ...(originReport ? { originReport: true as const } : {}) };
}
