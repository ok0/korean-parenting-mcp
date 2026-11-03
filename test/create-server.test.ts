import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createServer, type CreateServerOptions } from "../src/server/create-server.js";
import { SOURCE_NOTICE } from "../src/core/notice.js";
import { SERVER_INSTRUCTIONS } from "../src/server/instructions.js";
import { allTools, type ToolDef } from "../src/tools/registry.js";
import { createTestContext } from "./helpers/context.js";
import { echoTool, validFixtureTools } from "./helpers/fixture-tools.js";

async function connect(tools?: readonly ToolDef[], opts?: CreateServerOptions) {
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const server = createServer(createTestContext(), tools, opts);
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

  it("instructions include source notice", async () => {
    const { client } = await connect();
    const lines = client.getInstructions()!.split("\n");
    expect(lines[0]).toBe("korean-parenting-mcp는 한국 임신·출산·육아 일정과 공공 정보를 안내하는 MCP 서버입니다.");
    expect(lines[1]).toBe(`${SOURCE_NOTICE} 신청 기한·지원 금액은 정부24·복지로·국민건강보험공단·관할 주민센터·보건소에서, 건강 문제는 의료진과 상의해 주세요.`);
    expect(client.getInstructions()).not.toContain("비공식");
    expect(client.getInstructions()).not.toMatch(/아니|아닌|아님|아닙/);
    expect(client.getInstructions()).toContain("여석은 공시 기준 추정치");
    expect(client.getInstructions()).toContain("due_date");
    expect(client.getInstructions()).toContain("birth_date");
    expect(client.getInstructions()).toContain("get_leave_article");
    expect(client.getInstructions()).toContain("LAW_OC");
    expect(client.getInstructions()).toContain("find_night_pediatric");
    expect(client.getInstructions()).toContain("find_benefits");
    expect(client.getInstructions()).toContain("check_pregnancy_drug");
    expect(client.getInstructions()).toContain("check_recall");
    expect(client.getInstructions()).toContain("find_daycare");
    expect(client.getInstructions()).toContain("find_vaccination_clinic");
    expect(client.getInstructions()).toContain("find_checkup_clinic");
    expect(client.getInstructions()).toContain("find_kindergarten");
    expect(client.getInstructions()).toContain("find_local_support(DATA_GO_KR_SERVICE_KEY 필요)");
    expect(client.getInstructions()).toContain("15108347");
    expect(client.getInstructions()).toContain("SAFETYKOREA_AUTH_KEY");
    expect(client.getInstructions()).toContain("KINDERGARTEN_API_KEY");
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

  it("opts.instructions replaces instructions", async () => {
    const { client } = await connect(undefined, { instructions: "X" });
    expect(client.getInstructions()).toBe("X");
  });

  it("fallback answers unregistered names only", async () => {
    const fallback = (n: string) =>
      n === "gone" ? { content: [{ type: "text" as const, text: "안내" }] } : undefined;
    const { client } = await connect(validFixtureTools, { fallback });

    const gone = await client.callTool({ name: "gone", arguments: {} });
    expect(textOf(gone)).toBe("안내");
    expect(gone.isError).toBeFalsy();

    const other = await client.callTool({ name: "other", arguments: {} });
    expect(other.isError).toBe(true);
    expect(textOf(other)).toContain("알 수 없는 도구");

    const ok = await client.callTool({ name: "fx_echo", arguments: { text: "hi" } });
    expect(ok.isError).toBeFalsy();
    expect(textOf(ok)).toBe("hi");
  });

  it("no opts keeps SERVER_INSTRUCTIONS", async () => {
    const { client } = await connect();
    expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
  });
});
