#!/usr/bin/env node
import "./stdio-guard.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, secretsOf } from "./core/config.js";
import { createDefaultContext } from "./core/context.js";
import { maskSecrets } from "./core/secrets.js";
import { createServer } from "./server/create-server.js";

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const server = createServer(createDefaultContext(config));
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  process.stderr.write(
    maskSecrets(
      `korean-parenting-mcp 시작 실패: ${err instanceof Error ? err.message : String(err)}`,
      secretsOf(loadConfig(process.env)),
    ) + "\n",
  );
  process.exit(1);
});
