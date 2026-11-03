import { describe, expect, it } from "vitest";
import { z } from "zod";
import { KEY_ENV } from "../src/core/config.js";
import { formatToolError, KEY_GUIDE, missingKeyError, ToolError } from "../src/core/errors.js";
import { runTool } from "../src/core/pipeline.js";
import { defineTool } from "../src/tools/registry.js";
import { createTestContext } from "./helpers/context.js";

const SK = "Sk+id/=7 Q&z9";
const FORMS = [SK, encodeURIComponent(SK), new URLSearchParams({ x: SK }).toString().slice(2)];

const skLeakTool = defineTool({
  name: "fx_sk_leak",
  title: "SK 누출 (테스트)",
  description: "테스트 전용",
  schema: z.object({ mode: z.enum(["body", "footer", "throw", "toolerror", "log"]) }),
  annotations: { readOnlyHint: true as const, idempotentHint: true, openWorldHint: false },
  handler: async (args, ctx) => {
    const k = ctx.config.keys.SAFETYKOREA!;
    const forms = [k, encodeURIComponent(k), new URLSearchParams({ x: k }).toString().slice(2)];
    switch (args.mode) {
      case "body":
        return { body: forms.join(" ") };
      case "footer":
        return { body: "ok", footer: forms.join(" ") };
      case "throw":
        throw new Error(forms.join(" "));
      case "toolerror":
        throw new ToolError("UPSTREAM", forms.join(" "));
      case "log":
        ctx.log.warn(forms.join(" "));
        return { body: "ok" };
    }
  },
});

describe("SAFETYKOREA key wiring", () => {
  it("KEY_ENV and KEY_GUIDE cover the same key names including SAFETYKOREA", () => {
    expect(Object.keys(KEY_GUIDE).sort()).toEqual(Object.keys(KEY_ENV).sort());
    expect(Object.keys(KEY_ENV)).toContain("SAFETYKOREA");
    for (const k of Object.keys(KEY_ENV) as (keyof typeof KEY_ENV)[]) {
      expect(KEY_GUIDE[k].env).toBe(KEY_ENV[k]);
    }
    expect(KEY_ENV.SAFETYKOREA).toBe("SAFETYKOREA_AUTH_KEY");
  });

  it("SAFETYKOREA guide has url and lists check_recall", () => {
    expect(KEY_GUIDE.SAFETYKOREA.url).toBe("https://www.safetykorea.kr");
    expect(KEY_GUIDE.SAFETYKOREA.tools).toEqual(["check_recall"]);
    expect(KEY_GUIDE.SAFETYKOREA.title).toContain("서비스 ID");
  });

  it("missingKeyError for SAFETYKOREA explains env, issuance and AuthKey header", () => {
    const e = missingKeyError(["SAFETYKOREA"]);
    expect(e.kind).toBe("MISSING_KEY");
    const text = formatToolError(e, "x", createTestContext()).content[0]!.text;
    for (const s of ["SAFETYKOREA_AUTH_KEY", "신청", "승인", "발급", "AuthKey", "https://www.safetykorea.kr"]) {
      expect(text).toContain(s);
    }
    expect(text).toContain("승인 검토 후 발급까지 시간이 걸리며");
  });

  it("masks the SafetyKorea key in body, footer, thrown errors, ToolErrors and logs", async () => {
    for (const mode of ["body", "footer", "throw", "toolerror", "log"] as const) {
      const lines: string[] = [];
      const ctx = createTestContext({ env: { SAFETYKOREA_AUTH_KEY: SK }, sink: (line) => lines.push(line) });
      const res = await runTool(skLeakTool, { mode }, ctx);
      const text = res.content[0]!.text;
      const all = [text, ...lines].join("\n");
      for (const f of FORMS) expect(all).not.toContain(f);
      expect(ctx.secrets).toContain(SK);
    }
  });
});
