import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/server/create-server.js";
import { createTestContext } from "./helpers/context.js";

describe("local MCP surface (byte baseline)", () => {
  it("tools/list, instructions, unknown tool are unchanged", async () => {
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const server = createServer(createTestContext());
    await server.connect(st);
    const client = new Client({ name: "t", version: "0" });
    await client.connect(ct);
    const text = JSON.stringify(
      {
        instructions: client.getInstructions(),
        tools: (await client.listTools()).tools,
        unknown: await client.callTool({ name: "no_such_tool", arguments: {} }),
      },
      null,
      2,
    );
    await expect(text).toMatchFileSnapshot("./__snapshots__/local-surface.txt");
  });
});
