import type { ToolDef, ToolOutput } from "../tools/registry.js";
import { missingKeyError, ToolError, formatToolError, type ErrorKind, type ToolResult } from "./errors.js";
import type { ToolContext } from "./context.js";
import { maskSecrets } from "./secrets.js";

export const ARG_LIMITS = { maxString: 2000, maxDepth: 5, maxKeys: 50 } as const;

export interface OversizeFinding {
  path: string;
  reason: "string" | "depth" | "keys";
  actual: number;
  limit: number;
}

function walk(value: unknown, segments: string[], depth: number): OversizeFinding | null {
  const path = segments.join(".") || "(입력 전체)";
  if (typeof value === "string") {
    if (value.length > ARG_LIMITS.maxString) {
      return { path, reason: "string", actual: value.length, limit: ARG_LIMITS.maxString };
    }
    return null;
  }
  if (value !== null && typeof value === "object") {
    if (depth > ARG_LIMITS.maxDepth) {
      return { path, reason: "depth", actual: depth, limit: ARG_LIMITS.maxDepth };
    }
    const entries: [string, unknown][] = Array.isArray(value)
      ? value.map((v, i) => [String(i), v])
      : Object.entries(value);
    if (entries.length > ARG_LIMITS.maxKeys) {
      return { path, reason: "keys", actual: entries.length, limit: ARG_LIMITS.maxKeys };
    }
    for (const [k, v] of entries) {
      const found = walk(v, [...segments, k], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

export function findOversizedArg(value: unknown): OversizeFinding | null {
  return walk(value, [], 1);
}

export function finalize(out: ToolOutput, max: number, secrets: readonly string[]): string {
  let body = maskSecrets(out.body, secrets);
  const footerPart = out.footer ? "\n\n" + maskSecrets(out.footer, secrets) : "";
  const budget = Math.max(0, max - footerPart.length - 80);
  if (body.length > budget) {
    const omitted = body.length - budget;
    body = body.slice(0, budget) + `\n…(${omitted.toLocaleString("en-US")}자 생략: 범위를 줄여 다시 호출하세요)`;
  }
  return body + footerPart;
}

function describeFinding(f: OversizeFinding): string {
  if (f.reason === "string") return `문자열 길이 ${f.actual}자, 최대 ${f.limit}자`;
  if (f.reason === "depth") return `중첩 깊이 ${f.actual}, 최대 ${f.limit}`;
  return `항목 수 ${f.actual}개, 최대 ${f.limit}개`;
}

export async function runTool(def: ToolDef, rawArgs: unknown, ctx: ToolContext): Promise<ToolResult> {
  const t0 = Date.now();
  let result: ToolResult;
  let kind: ErrorKind | undefined;
  try {
    const f = findOversizedArg(rawArgs);
    if (f) {
      throw new ToolError("BAD_INPUT", `입력 값이 너무 큽니다: ${f.path} (${describeFinding(f)})`, {
        actions: ["값을 줄이거나 나누어 다시 호출하세요."],
      });
    }

    const parsed = def.schema.safeParse(rawArgs ?? {});
    if (!parsed.success) {
      const lines = parsed.error.issues
        .slice(0, 10)
        .map((i) => `- ${i.path.join(".") || "(입력 전체)"}: ${i.message}`)
        .join("\n");
      throw new ToolError("BAD_INPUT", "입력 검증 실패:\n" + lines, {
        actions: ["각 필드 설명(describe)의 형식과 예시를 확인해 해당 필드를 고친 뒤 다시 호출하세요."],
      });
    }

    const missing = (def.requiredKeys ?? []).filter((k) => !ctx.config.keys[k]);
    if (missing.length > 0) throw missingKeyError(missing);

    const out = await def.handler(parsed.data, ctx);
    const text = finalize(out, def.maxChars ?? ctx.config.maxResponseChars, ctx.secrets);
    ctx.log.debug("tool call", { tool: def.name, ms: Date.now() - t0 });
    result = { content: [{ type: "text", text }] };
  } catch (e) {
    kind = e instanceof ToolError ? e.kind : "INTERNAL";
    result = formatToolError(e, def.name, ctx);
  }
  if (ctx.onToolDone) {
    const ev = kind === undefined ? { tool: def.name, ok: true, ms: Date.now() - t0 } : { tool: def.name, ok: false, kind, ms: Date.now() - t0 };
    try { ctx.onToolDone(ev); } catch { /* hook errors never change the result */ }
  }
  return result;
}
