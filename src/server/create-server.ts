import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ToolContext } from "../core/context.js";
import { ToolError, formatToolError, type ToolResult } from "../core/errors.js";
import { runTool } from "../core/pipeline.js";
import { allTools, type ToolDef } from "../tools/registry.js";
import { SERVER_INSTRUCTIONS } from "./instructions.js";
import { VERSION } from "../version.js";

export interface CreateServerOptions {
  instructions?: string;
  fallback?: (name: string) => ToolResult | undefined;
}

export function createServer(ctx: ToolContext, tools: readonly ToolDef[] = allTools, opts: CreateServerOptions = {}): Server {
  const server = new Server(
    { name: "korean-parenting-mcp", version: VERSION },
    { capabilities: { tools: {} }, instructions: opts.instructions ?? SERVER_INSTRUCTIONS },
  );

  const byName = new Map<string, ToolDef>();
  for (const t of tools) {
    if (byName.has(t.name)) throw new Error(`중복 도구 이름: ${t.name}`);
    byName.set(t.name, t);
  }

  let listed: Tool[] | undefined;

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    listed ??= tools.map((t) => {
      const inputSchema = z.toJSONSchema(t.schema, { io: "input" }) as Record<string, unknown>;
      delete inputSchema.$schema;
      return {
        name: t.name,
        title: t.title,
        description: t.description,
        inputSchema,
        annotations: t.annotations,
      } as Tool;
    });
    return { tools: listed };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const def = byName.get(name);
    if (!def) {
      const fb = opts.fallback?.(name);
      if (fb) return fb;
      return formatToolError(
        new ToolError("BAD_INPUT", `알 수 없는 도구: ${name}`, {
          actions: [
            tools.length
              ? `사용 가능한 도구: ${[...byName.keys()].join(", ")}`
              : "현재 사용 가능한 도구가 없습니다. tools/list로 목록을 확인하세요.",
          ],
        }),
        name,
        ctx,
      );
    }
    return runTool(def, args, ctx);
  });

  return server;
}
