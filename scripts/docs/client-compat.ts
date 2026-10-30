import { z } from "zod";
import { allTools, type ToolDef } from "../../src/tools/registry.js";
import { SERVER_NAME } from "./links.js";
import { isMainModule } from "../lib/script-io.js";

export const GEMINI_MAX_NAME = 63;
export const TOOL_NAME_CHARS = /^[A-Za-z0-9_:.-]+$/;
export const SERVER_NAME_CHARS = /^[A-Za-z0-9-]+$/;

export interface CompatTool { readonly name: string; readonly inputSchema: Record<string, unknown>; }
export interface CompatIssue { level: "error" | "info"; tool?: string; rule: string; detail: string; }
export interface CompatRow { tool: string; prefixedName: string; length: number; lengthOk: boolean; charsOk: boolean; schemaSame: boolean; removed: string[]; }
export interface CompatReport { serverName: string; serverNameOk: boolean; rows: CompatRow[]; issues: CompatIssue[]; }

/** Gemini CLI가 도구 이름 앞에 붙이는 접두 이름(mcp_서버이름_도구). */
export function prefixedName(serverName: string, tool: string): string {
  return "mcp_" + serverName + "_" + tool;
}

/** 일부 앱이 지우는 스키마 항목을 복사본에서 지우고, 지운 경로 목록을 돌려줘요. 입력은 바꾸지 않아요. */
export function stripUnsupported(schema: unknown): { schema: unknown; removed: string[] } {
  const removed: string[] = [];
  const walk = (node: unknown, path: string, inAnyOfItem: boolean): unknown => {
    if (Array.isArray(node)) return node.map((el, i) => walk(el, `${path}/${i}`, inAnyOfItem));
    if (node !== null && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node)) {
        if (k === "$schema" || k === "additionalProperties" || (inAnyOfItem && k === "default")) {
          removed.push(`${path}/${k}`);
          continue;
        }
        out[k] = walk(v, `${path}/${k}`, k === "anyOf");
      }
      return out;
    }
    return node;
  };
  return { schema: walk(schema, "", false), removed };
}

function topLevelSame(before: Record<string, unknown>, after: Record<string, unknown>): boolean {
  const keys = (s: Record<string, unknown>) => Object.keys((s.properties ?? {}) as Record<string, unknown>).sort();
  const req = (s: Record<string, unknown>) => [...((s.required ?? []) as string[])].sort();
  return JSON.stringify(keys(before)) === JSON.stringify(keys(after)) && JSON.stringify(req(before)) === JSON.stringify(req(after));
}

/** 서버 이름과 도구 이름·스키마를 Gemini CLI 기준으로 점검해요. 네트워크를 쓰지 않아요. */
export function compatReport(tools: readonly CompatTool[], serverName: string = SERVER_NAME): CompatReport {
  const issues: CompatIssue[] = [];
  const serverNameOk = !serverName.includes("_") && SERVER_NAME_CHARS.test(serverName);
  if (serverName.includes("_")) {
    issues.push({ level: "error", rule: "server-name-underscore", detail: `서버 이름 ${serverName}에 밑줄(_)이 있어요. 하이픈(-)을 써 주세요.` });
  } else if (!SERVER_NAME_CHARS.test(serverName)) {
    issues.push({ level: "error", rule: "server-name-chars", detail: `서버 이름 ${serverName}에 허용되지 않는 문자가 있어요.` });
  }
  const rows: CompatRow[] = [];
  for (const t of tools) {
    const p = prefixedName(serverName, t.name);
    const lengthOk = p.length <= GEMINI_MAX_NAME;
    const charsOk = TOOL_NAME_CHARS.test(p);
    if (!lengthOk) issues.push({ level: "error", tool: t.name, rule: "name-length", detail: `${p} (${p.length}자 > 63)` });
    if (!charsOk) issues.push({ level: "error", tool: t.name, rule: "name-chars", detail: `${p} 이름에 허용되지 않는 문자가 있어요.` });
    const { schema: stripped, removed } = stripUnsupported(t.inputSchema);
    const schemaSame = topLevelSame(t.inputSchema, stripped as Record<string, unknown>);
    if (!schemaSame) {
      issues.push({ level: "error", tool: t.name, rule: "schema-changed", detail: "스키마 항목을 지운 뒤 properties 또는 required가 달라져요." });
    }
    if (removed.length > 0) {
      issues.push({ level: "info", tool: t.name, rule: "schema-stripped", detail: "일부 앱이 지우는 항목: " + removed.join(", ") + " — 서버 쪽 입력 검사는 그대로 적용돼요" });
    }
    rows.push({ tool: t.name, prefixedName: p, length: p.length, lengthOk, charsOk, schemaSame, removed });
  }
  return { serverName, serverNameOk, rows, issues };
}

/** src/server/create-server.ts와 같은 방식으로 등록된 도구의 입력 스키마를 만들어요. */
export function registryTools(tools: readonly ToolDef[] = allTools): CompatTool[] {
  return tools.map((t) => {
    const s = z.toJSONSchema(t.schema, { io: "input" }) as Record<string, unknown>;
    delete s.$schema;
    return { name: t.name, inputSchema: s };
  });
}

export function formatCompatReport(r: CompatReport): string {
  const lines: string[] = [];
  lines.push("호환 점검(Gemini CLI식 도구 이름·스키마 기준, 네트워크·키 없이)");
  lines.push(`서버 이름 ${r.serverName}: ${r.serverNameOk ? "통과" : "실패(밑줄·허용 문자 확인)"}`);
  lines.push("도구 | 접두 이름 길이(≤63) | 허용 문자 | 스키마 제거 후 properties/required 같음 | 일부 앱이 지우는 항목");
  for (const x of r.rows) {
    lines.push(`${x.tool} | ${x.length} ${x.lengthOk ? "통과" : "실패"} | ${x.charsOk ? "통과" : "실패"} | ${x.schemaSame ? "통과" : "실패"} | ${x.removed.length ? x.removed.join(", ") : "없음"}`);
  }
  for (const i of r.issues) {
    lines.push(`${i.level === "error" ? "[오류]" : "[참고]"} ${i.tool ? i.tool + ": " : ""}${i.detail}`);
  }
  const errors = r.issues.filter((i) => i.level === "error").length;
  const infos = r.issues.filter((i) => i.level === "info").length;
  lines.push(`오류 ${errors}건 · 참고 ${infos}건 — 보고만 하며 서버는 바꾸지 않아요.`);
  return lines.join("\n") + "\n";
}

if (isMainModule(import.meta.url)) {
  process.stdout.write(formatCompatReport(compatReport(registryTools())));
  process.exitCode = 0;
}
