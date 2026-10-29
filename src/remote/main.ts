import { createServer as createHttpServer } from "node:http";
import { buildRemoteDeps, createRemoteHandler } from "./app.js";
import { loadRemoteConfig, RemoteConfigError, type RemoteConfig } from "./remote-config.js";

let rc: RemoteConfig;
try {
  rc = loadRemoteConfig(process.env);
} catch (e) {
  process.stderr.write(`원격 서버 설정 오류: ${e instanceof RemoteConfigError ? e.item : "unknown"}\n`);
  process.exit(1);
}

const handler = createRemoteHandler(buildRemoteDeps(rc));
const server = createHttpServer((req, res) => {
  void handler(req, res);
});

server.on("error", (err: NodeJS.ErrnoException) => {
  process.stderr.write(`원격 서버 시작 실패: ${err.code ?? "unknown"}\n`);
  process.exit(1);
});

server.listen(rc.port, rc.host, () => {
  const a = server.address();
  const port = typeof a === "object" && a ? a.port : rc.port;
  process.stderr.write(`korean-parenting-mcp remote listening on ${rc.host}:${port}\n`);
});

const shutdown = (): void => {
  handler.closeStreams();
  server.close(() => process.exit(0));
  server.closeIdleConnections();
  setTimeout(() => {
    server.closeAllConnections();
    process.exit(0);
  }, 9000).unref();
};
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
