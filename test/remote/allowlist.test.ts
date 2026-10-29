import { describe, expect, it } from "vitest";
import { KEY_GUIDE } from "../../src/core/errors.js";
import { allTools } from "../../src/tools/registry.js";
import { NOTICE_UNOFFICIAL } from "../../src/tools/shared/format.js";
import { SERVER_INSTRUCTIONS } from "../../src/server/instructions.js";
import {
  buildRemoteInstructions,
  excludedFallback,
  policyViolations,
  REMOTE_EXCLUDED_HEADING,
  REMOTE_POLICY,
  REMOTE_PRIVACY_HEADING,
  remoteTools,
  type RemotePolicy,
} from "../../src/remote/allowlist.js";
import { REMOTE_INPUT_NOTICE } from "../../src/remote/privacy.js";

const names = allTools.map((t) => t.name);

describe("remote allowlist policy", () => {
  it("policy matches registry and invariants hold", () => {
    expect(policyViolations(REMOTE_POLICY, names)).toEqual([]);
  });

  it("check_recall excluded (PAC18 auto)", () => {
    const row = REMOTE_POLICY.find((p) => p.tool === "check_recall");
    expect(row?.expose).toBe(false);
    const exposed = remoteTools(allTools).map((t) => t.name);
    expect(exposed).not.toContain("check_recall");
    expect(exposed).toHaveLength(9);
    expect(exposed).toEqual(names.filter((n) => n !== "check_recall"));
  });

  const clone = (): RemotePolicy[] => structuredClone([...REMOTE_POLICY]);

  it.each([
    ["row removed", () => clone().filter((p) => p.tool !== "get_timeline")],
    ["duplicate row", () => [...clone(), clone()[0]!]],
    [
      "check_recall exposed while not-asked",
      () => clone().map((p) => (p.tool === "check_recall" ? { ...p, expose: true } : p)),
    ],
    ["ghost tool row", () => [...clone(), { tool: "ghost_tool", expose: true, providers: [], verdict: "해당 없음", conditions: [], confirmation: {} } as RemotePolicy]],
    [
      "find_benefits denied but exposed",
      () => clone().map((p) => (p.tool === "find_benefits" ? { ...p, confirmation: { mois: "denied" as const } } : p)),
    ],
    [
      "check_recall replacement removed",
      () => clone().map((p) => (p.tool === "check_recall" ? { ...p, replacement: undefined } : p)),
    ],
  ])("violations detected: %s", (_label, make) => {
    expect(policyViolations(make(), names).length).toBeGreaterThanOrEqual(1);
  });

  it("check_recall exposed and allowed has no violations", () => {
    const policy = clone().map((p) =>
      p.tool === "check_recall" ? { ...p, expose: true, confirmation: { safetykorea: "allowed" as const } } : p,
    );
    expect(policyViolations(policy, names)).toEqual([]);
  });

  it("fallback answers excluded tools only", () => {
    const fb = excludedFallback("check_recall");
    expect(fb).toBeDefined();
    expect(fb).not.toHaveProperty("isError");
    const text = fb!.content[0]!.text;
    expect(text).toContain("https://www.safetykorea.kr");
    expect(text).toContain(NOTICE_UNOFFICIAL);
    expect(text).toContain(KEY_GUIDE.SAFETYKOREA.url);
    expect(excludedFallback("get_timeline")).toBeUndefined();
    expect(excludedFallback("nope")).toBeUndefined();
  });

  it("instructions append excluded section only when rows exist", () => {
    const text = buildRemoteInstructions();
    expect(text.startsWith(SERVER_INSTRUCTIONS)).toBe(true);
    expect(text).toContain(REMOTE_EXCLUDED_HEADING);
    expect(text).toContain("check_recall");
    expect(text).toContain("https://www.safetykorea.kr");
    const allExposed = REMOTE_POLICY.map((p) => ({ ...p, expose: true }));
    expect(buildRemoteInstructions(allExposed)).toBe(
      `${SERVER_INSTRUCTIONS}\n\n${REMOTE_PRIVACY_HEADING}\n${REMOTE_INPUT_NOTICE}\n개인정보 처리방침: 이 서버의 /privacy 경로에서 볼 수 있습니다.`,
    );
    expect(buildRemoteInstructions(allExposed)).not.toContain(REMOTE_EXCLUDED_HEADING);
    expect(text.endsWith("/privacy 경로에서 볼 수 있습니다.")).toBe(true);
  });

  it("remote descriptions carry the notice and do not mutate local tools", () => {
    const originals = new Map(allTools.map((t) => [t.name, t.description]));
    for (const t of remoteTools(allTools)) {
      const o = allTools.find((x) => x.name === t.name)!;
      expect(t.description).toBe(`${o.description}\n\n${REMOTE_INPUT_NOTICE}`);
      expect(t).not.toBe(o);
    }
    for (const t of allTools) {
      expect(t.description).not.toContain(REMOTE_INPUT_NOTICE);
      expect(t.description).toBe(originals.get(t.name));
    }
  });
});
