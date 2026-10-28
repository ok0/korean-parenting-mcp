import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/server/create-server.js";
import { allTools, type ToolDef } from "../src/tools/registry.js";
import { createTestContext } from "./helpers/context.js";
import { echoTool, validFixtureTools } from "./helpers/fixture-tools.js";

async function connect(tools?: readonly ToolDef[]) {
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const server = createServer(createTestContext(), tools);
  await server.connect(st);
  const client = new Client({ name: "t", version: "0" });
  await client.connect(ct);
  return { server, client };
}

function textOf(res: object): string {
  return (res as { content: { type: string; text: string }[] }).content[0]!.text;
}

describe("createServer", () => {
  it("creates server without transport", () => {
    const server = createServer(createTestContext());
    expect(server.transport).toBeUndefined();
  });

  it("instructions include unofficial notice", async () => {
    const { client } = await connect();
    expect(client.getInstructions()).toContain("비공식");
    expect(client.getInstructions()).toContain("due_date");
    expect(client.getInstructions()).toContain("birth_date");
    expect(client.getInstructions()).toContain("get_leave_article");
    expect(client.getInstructions()).toContain("LAW_OC");
    expect(client.getInstructions()).toContain("find_night_pediatric");
    expect(client.getInstructions()).toContain("find_benefits");
    expect(client.getInstructions()).toContain("check_pregnancy_drug");
  });

  it("tools/list matches registry (empty in M1)", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(allTools.map((t) => t.name));
  });

  it("tools/list matches injected tools with JSON Schema", async () => {
    const { client } = await connect(validFixtureTools);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(validFixtureTools.map((t) => t.name).sort());

    for (const t of tools) {
      const schema = t.inputSchema as Record<string, unknown>;
      expect(schema.type).toBe("object");
      expect(schema).not.toHaveProperty("$schema");
      expect(t.title).toBeTruthy();
      expect(t.annotations?.readOnlyHint).toBe(true);
    }

    const echo = tools.find((t) => t.name === "fx_echo")!;
    const props = (echo.inputSchema as { properties: Record<string, { description?: string }> }).properties;
    expect(props.text!.description).toBeTruthy();
    expect(props.count!.description).toBeTruthy();
    const required = (echo.inputSchema as { required?: string[] }).required ?? [];
    expect(required).toContain("text");
    expect(required).not.toContain("count");
  });

  it("unknown tool returns isError with tool list", async () => {
    const { client } = await connect(validFixtureTools);
    const bad = await client.callTool({ name: "nope", arguments: {} });
    expect(bad.isError).toBe(true);
    const badText = textOf(bad);
    expect(badText).toContain("알 수 없는 도구: nope");
    expect(badText).toContain("fx_echo");

    const ok = await client.callTool({ name: "fx_echo", arguments: { text: "hi" } });
    expect(ok.isError).toBeFalsy();
    expect(textOf(ok)).toBe("hi");
  });

  it("duplicate tool names throw", () => {
    expect(() => createServer(createTestContext(), [echoTool, echoTool])).toThrow("중복");
  });
});
