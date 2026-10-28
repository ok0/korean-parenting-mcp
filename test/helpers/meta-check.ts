import { z } from "zod";
import type { ToolDef } from "../../src/tools/registry.js";

const KEY_FIELD = /(service_?key|api_?key|^key$|^oc$|token|secret|password)/i;

export function checkToolMeta(def: ToolDef, allNames: readonly string[] = []): string[] {
  const problems: string[] = [];
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(def.name)) problems.push(`${def.name}: 이름 형식`);
  if (def.title.trim() === "") problems.push(`${def.name}: title 누락`);
  if (def.description.trim() === "") problems.push(`${def.name}: description 누락`);
  if (allNames.some((n) => n !== def.name && def.description.includes(n))) {
    problems.push(`${def.name}: 설명에 다른 도구 지시`);
  }
  if (def.annotations.readOnlyHint !== true) problems.push(`${def.name}: readOnlyHint`);

  const js = z.toJSONSchema(def.schema, { io: "input" }) as {
    type?: unknown;
    properties?: Record<string, { description?: unknown }>;
  };
  if (js.type !== "object") problems.push(`${def.name}: 입력 스키마가 object 아님`);
  for (const [p, prop] of Object.entries(js.properties ?? {})) {
    if (typeof prop.description !== "string" || prop.description.trim() === "") {
      problems.push(`${def.name}.${p}: describe 누락`);
    }
    if (KEY_FIELD.test(p)) problems.push(`${def.name}.${p}: 키 필드 노출`);
  }
  return problems;
}
