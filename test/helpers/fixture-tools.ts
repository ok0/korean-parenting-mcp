import { z } from "zod";
import { ToolError } from "../../src/core/errors.js";
import { defineTool } from "../../src/tools/registry.js";
import { enumField, intField, keywordField } from "../../src/tools/shared/schema.js";

const annotations = { readOnlyHint: true as const, idempotentHint: true, openWorldHint: false };

export const echoTool = defineTool({
  name: "fx_echo",
  title: "문장 되돌리기 (테스트)",
  description: "입력 문장을 지정한 횟수만큼 되돌려 줍니다. 테스트 전용 도구입니다.",
  schema: z.object({
    text: keywordField({ purpose: "되돌려 받을 문장", format: "1~50자 문자열", example: "안녕" }),
    count: intField({ purpose: "반복 횟수", format: "1~3 정수", example: "2" }, { min: 1, max: 3 }).optional(),
  }),
  annotations,
  handler: async (args) => ({ body: args.text.repeat(args.count ?? 1) }),
});

export const keyTool = defineTool({
  name: "fx_key",
  title: "키 필요 도구 (테스트)",
  description: "공공데이터 인증키가 있어야 실행되는 테스트 전용 도구입니다.",
  schema: z.object({}),
  annotations,
  requiredKeys: ["DATA_GO_KR"],
  handler: async () => ({ body: "ok" }),
});

export const throwTool = defineTool({
  name: "fx_throw",
  title: "예외 발생 (테스트)",
  description: "핸들러에서 일반 예외를 던지는 테스트 전용 도구입니다.",
  schema: z.object({}),
  annotations,
  handler: async () => {
    throw new Error("boom");
  },
});

export const upstreamTool = defineTool({
  name: "fx_upstream",
  title: "기관 오류 (테스트)",
  description: "기관 서버 오류를 흉내 내는 테스트 전용 도구입니다.",
  schema: z.object({}),
  annotations,
  handler: async () => {
    throw new ToolError("UPSTREAM", "기관 서버 오류");
  },
});

export const longTool = defineTool({
  name: "fx_long",
  title: "긴 응답 (테스트)",
  description: "최대 길이를 넘는 본문과 고정 footer를 반환하는 테스트 전용 도구입니다.",
  schema: z.object({}),
  annotations,
  maxChars: 1000,
  handler: async () => ({ body: "가".repeat(5000), footer: "출처: 테스트 데이터 · 면책: 참고용" }),
});

export const defaultMaxTool = defineTool({
  name: "fx_default_max",
  title: "기본 상한 응답 (테스트)",
  description: "설정의 기본 응답 상한을 확인하는 테스트 전용 도구입니다.",
  schema: z.object({}),
  annotations,
  handler: async () => ({ body: "a".repeat(5000) }),
});

export const leakTool = defineTool({
  name: "fx_leak",
  title: "키 누출 시험 (테스트)",
  description: "여러 위치에 키를 노출해 마스킹을 확인하는 테스트 전용 도구입니다.",
  schema: z.object({
    mode: enumField(["body", "footer", "throw", "toolerror", "log"], {
      purpose: "누출 위치",
      format: "열거값",
      example: "body",
    }),
  }),
  annotations,
  handler: async (args, ctx) => {
    const k = ctx.config.keys.DATA_GO_KR!;
    const forms = [k, encodeURIComponent(k), new URLSearchParams({ x: k }).toString().slice(2)];
    switch (args.mode) {
      case "body":
        return { body: forms.join(" ") };
      case "footer":
        return { body: "ok", footer: forms.join(" ") };
      case "throw":
        throw new Error(forms.join(" "));
      case "toolerror":
        throw new ToolError("KEY_INVALID", forms.join(" "));
      case "log":
        ctx.log.warn(forms.join(" "));
        return { body: "logged" };
    }
  },
});

export const badMetaTool = defineTool({
  name: "fx_bad_meta",
  title: "",
  description: "검사기 음성 대조용 테스트 전용 도구입니다.",
  schema: z.object({ q: z.string(), serviceKey: z.string().describe("키") }),
  annotations,
  handler: async () => ({ body: "x" }),
});

export const validFixtureTools = [
  echoTool,
  keyTool,
  throwTool,
  upstreamTool,
  longTool,
  defaultMaxTool,
  leakTool,
];
