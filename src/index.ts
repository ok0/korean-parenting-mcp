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

const isSetup = process.argv[2] === "setup";

async function setupMain(): Promise<void> {
  const { runSetup } = await import("./setup/setup.js");
  process.exitCode = await runSetup();
}

(isSetup ? setupMain : main)().catch((err) => {
  process.stderr.write(
    maskSecrets(
      `${isSetup ? "korean-parenting-mcp setup 실패" : "korean-parenting-mcp 시작 실패"}: ${err instanceof Error ? err.message : String(err)}`,
      secretsOf(loadConfig(process.env)),
    ) + "\n",
  );
  process.exit(1);
});
