import { describe, expect, it } from "vitest";
import { KEY_GUIDE } from "../../src/core/errors.js";
import { allTools } from "../../src/tools/registry.js";
import { NOTICE_SOURCE } from "../../src/tools/shared/format.js";
import { SERVER_INSTRUCTIONS } from "../../src/server/instructions.js";
import { resolveBasis } from "../../src/data-store/load.js";
import {
  buildRemoteInstructions,
  excludedFallback,
  policyViolations,
  REMOTE_EXCLUDED_HEADING,
  REMOTE_POLICY,
  REMOTE_PRIVACY_HEADING,
  REMOTE_SERVER_INSTRUCTIONS,
  remoteTools,
  type RemotePolicy,
} from "../../src/remote/allowlist.js";
import { REMOTE_INPUT_NOTICE, REMOTE_LAW_NOTICE } from "../../src/remote/privacy.js";

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
    expect(exposed).toHaveLength(8);
    expect(exposed).toEqual(names.filter((n) => n !== "check_recall" && n !== "get_leave_article" && n !== "find_local_support"));
  });

  it("find_local_support excluded, local only (M62)", () => {
    const row = REMOTE_POLICY.find((p) => p.tool === "find_local_support");
    expect(row?.expose).toBe(false);
    expect(row?.providers).toEqual([]);
    expect(remoteTools(allTools).map((t) => t.name)).not.toContain("find_local_support");
    const fb = excludedFallback("find_local_support");
    expect(fb).toBeDefined();
    expect(fb).not.toHaveProperty("isError");
    const text = fb!.content[0]!.text;
    expect(text).toContain("https://www.bokjiro.go.kr");
    expect(text).toContain("로컬 모드");
    expect(text).toContain(NOTICE_SOURCE);
    const summary = row!.replacement!.summary;
    expect(summary).not.toMatch(/원격|곧 제공|제공할 예정|안내할 예정/);
    expect(summary).not.toMatch(/아니|아닌|아님|아닙|비공식|무관/);
    expect(buildRemoteInstructions()).toContain("find_local_support");
    expect(REMOTE_SERVER_INSTRUCTIONS).not.toContain("find_local_support");
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
    [
      "blockedBy with expose",
      () => clone().map((p) => (p.tool === "get_leave_article" ? { ...p, expose: true } : p)),
    ],
  ])("violations detected: %s", (_label, make) => {
    expect(policyViolations(make(), names).length).toBeGreaterThanOrEqual(1);
  });

  it("blockedBy with expose reports ip-registration", () => {
    const policy = clone().map((p) => (p.tool === "get_leave_article" ? { ...p, expose: true } : p));
    expect(policyViolations(policy, names).some((v) => v.includes("ip-registration"))).toBe(true);
  });

  it("violation messages use positive wording", () => {
    const ghost = [...clone(), { tool: "ghost_tool", expose: true, providers: [], verdict: "해당 없음", conditions: [], confirmation: {} } as RemotePolicy];
    expect(policyViolations(ghost, names)).toContain("ghost_tool: 정책 행의 도구는 등록된 도구여야 합니다");
    const unclear = clone().map((p) =>
      p.tool === "find_benefits" ? ({ ...p, verdict: "불명확", confirmation: { mois: "not-asked" } } as RemotePolicy) : p,
    );
    expect(policyViolations(unclear, names)).toContain("find_benefits: 판정 불명확인데 노출되므로 mois 서면 확인은 allowed여야 합니다");
  });

  it("blockedBy rows are not exposed", () => {
    for (const p of REMOTE_POLICY) {
      if (p.blockedBy !== undefined) expect(p.expose).toBe(false);
    }
    expect(REMOTE_POLICY.find((p) => p.tool === "get_leave_article")?.blockedBy).toBe("ip-registration");
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
    expect(text).toContain(NOTICE_SOURCE);
    expect(text).toContain(KEY_GUIDE.SAFETYKOREA.url);
    expect(excludedFallback("get_timeline")).toBeUndefined();
    expect(excludedFallback("nope")).toBeUndefined();
  });

  it("leave fallback links law.go.kr originals", () => {
    const fb = excludedFallback("get_leave_article");
    expect(fb).toBeDefined();
    expect(fb).not.toHaveProperty("isError");
    const text = fb!.content[0]!.text;
    expect(text).toContain("고정 출구 IP");
    expect(text).toContain("로컬 모드");
    const linkLines = text.split("\n").filter((l) => l.startsWith("- "));
    expect(linkLines).toHaveLength(3);
    for (const l of linkLines) expect(l).toMatch(/https:\/\/www\.law\.go\.kr\//);
    const urls = new Set(linkLines.map((l) => l.slice(l.indexOf("https://"))));
    expect(urls).toEqual(
      new Set([resolveBasis(["equal-employment-act"])[0]!.url, resolveBasis(["labor-standards-act"])[0]!.url]),
    );
    expect(urls.size).toBe(2);
  });

  it("remote instructions drop the local leave sentence and state the remote law notice", () => {
    expect(REMOTE_SERVER_INSTRUCTIONS).not.toContain("LAW_OC");
    expect(REMOTE_SERVER_INSTRUCTIONS).toContain(REMOTE_LAW_NOTICE);
    expect(SERVER_INSTRUCTIONS).toContain("get_leave_article(LAW_OC 필요)");
  });

  it("instructions append excluded section only when rows exist", () => {
    const text = buildRemoteInstructions();
    expect(text.startsWith(REMOTE_SERVER_INSTRUCTIONS)).toBe(true);
    expect(text).toContain(REMOTE_EXCLUDED_HEADING);
    expect(text).toContain("get_leave_article");
    expect(text).toContain("check_recall");
    expect(text).toContain("https://www.safetykorea.kr");
    const allExposed = REMOTE_POLICY.map((p) => ({ ...p, expose: true }));
    expect(buildRemoteInstructions(allExposed)).toBe(
      `${REMOTE_SERVER_INSTRUCTIONS}\n\n${REMOTE_PRIVACY_HEADING}\n${REMOTE_INPUT_NOTICE}\n개인정보 처리방침: 이 서버의 /privacy 경로에서 볼 수 있습니다.`,
    );
    expect(buildRemoteInstructions(allExposed)).not.toContain(REMOTE_EXCLUDED_HEADING);
    expect(text.endsWith("/privacy 경로에서 볼 수 있습니다.")).toBe(true);
  });

  it("remote descriptions carry the notice and do not mutate local tools", () => {
    const originals = new Map(allTools.map((t) => [t.name, t.description]));
    for (const t of remoteTools(allTools)) {
      const o = allTools.find((x) => x.name === t.name)!;
      if (t.name === "get_timeline") {
        expect(t.description).toContain("개정 여부 확인 불가(원격)");
        expect(t.description).not.toContain("LAW_OC");
        expect(t.description.endsWith(`\n\n${REMOTE_INPUT_NOTICE}`)).toBe(true);
      } else {
        expect(t.description).toBe(`${o.description}\n\n${REMOTE_INPUT_NOTICE}`);
      }
      expect(t).not.toBe(o);
    }
    for (const t of allTools) {
      expect(t.description).not.toContain(REMOTE_INPUT_NOTICE);
      expect(t.description).toBe(originals.get(t.name));
    }
  });
});
