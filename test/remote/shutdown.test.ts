import { describe, expect, it } from "vitest";
import { releaseRemoteState } from "../../src/remote/app.js";
import { initBody, mcpHeaders, rawRequest, startRemote } from "../helpers/remote-server.js";

describe("remote shutdown state", () => {
  it("releaseRemoteState clears limiter, cache and streams (AC6)", async () => {
    const srv = await startRemote({
      rate: { perClientPerMin: 100, sharedPoolPerMin: 100, globalPerMin: 100, maxConcurrent: 16 },
    });
    try {
      const init = await rawRequest(srv.port, { method: "POST", path: "/mcp", headers: mcpHeaders, body: initBody() });
      expect(init.status).toBe(200);
      expect(srv.deps.limiter.trackedClients).toBeGreaterThanOrEqual(1);

      srv.deps.baseCtx.cache.set("k", 1, 60_000, Date.now());
      expect(srv.deps.baseCtx.cache.size).toBeGreaterThanOrEqual(1);

      const sse = await rawRequest(srv.port, {
        method: "GET",
        path: "/mcp",
        headers: { accept: "text/event-stream" },
        untilHeaders: true,
      });
      expect(sse.status).toBe(200);
      expect(srv.handler.openStreams).toBe(1);

      releaseRemoteState(srv.deps, srv.handler);
      await new Promise((r) => setTimeout(r, 20));

      expect(srv.deps.limiter.trackedClients).toBe(0);
      expect(srv.deps.baseCtx.cache.size).toBe(0);
      expect(srv.handler.openStreams).toBe(0);
      sse.destroy();
    } finally {
      await srv.close();
    }
  });
});
