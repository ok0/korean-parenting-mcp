import { describe, expect, it } from "vitest";
import { allTools } from "../src/tools/registry.js";
import { SERVER_NAME } from "../scripts/docs/links.js";
import {
  compatReport,
  formatCompatReport,
  prefixedName,
  registryTools,
  stripUnsupported,
  type CompatTool,
} from "../scripts/docs/client-compat.js";

const obj = (props: Record<string, unknown>, required: string[]) => ({ type: "object", properties: props, required });

describe("client compat report", () => {
  it("real registry: no errors, longest prefixed name 44 (AC5)", () => {
    const r = compatReport(registryTools());
    expect(r.serverName).toBe(SERVER_NAME);
    expect(r.serverNameOk).toBe(true);
    expect(r.issues.filter((i) => i.level === "error")).toEqual([]);
    expect(r.rows.map((x) => x.tool)).toEqual(allTools.map((t) => t.name));
    expect(Math.max(...r.rows.map((x) => x.length))).toBe(44);
    expect(r.rows.find((x) => x.length === 44)?.tool).toBe("find_vaccination_clinic");
    expect(r.rows.every((x) => x.schemaSame === true)).toBe(true);
    expect(registryTools().every((t) => !("$schema" in t.inputSchema))).toBe(true);
  });

  it("synthetic violations are errors (AC5)", () => {
    const base = prefixedName(SERVER_NAME, "").length;

    const longName = "a".repeat(64 - base);
    const long = compatReport([{ name: longName, inputSchema: obj({}, []) }]);
    expect(long.rows[0]?.length).toBe(64);
    expect(long.rows[0]?.lengthOk).toBe(false);
    expect(long.issues.some((i) => i.level === "error" && i.rule === "name-length")).toBe(true);

    const edgeName = "a".repeat(63 - base);
    const edge = compatReport([{ name: edgeName, inputSchema: obj({}, []) }]);
    expect(edge.rows[0]?.length).toBe(63);
    expect(edge.issues.filter((i) => i.level === "error")).toEqual([]);

    const chars = compatReport([{ name: "find daycare!", inputSchema: obj({}, []) }]);
    expect(chars.issues.some((i) => i.level === "error" && i.rule === "name-chars")).toBe(true);
    expect(chars.rows[0]?.charsOk).toBe(false);

    const underscore = compatReport(
      [{ name: "find_daycare", inputSchema: obj({}, []) }],
      SERVER_NAME.replace("-", "_"),
    );
    expect(underscore.issues.some((i) => i.level === "error" && i.rule === "server-name-underscore")).toBe(true);
    expect(underscore.serverNameOk).toBe(false);

    const schema = compatReport([
      {
        name: "find_daycare",
        inputSchema: obj({ additionalProperties: { type: "string" }, q: { type: "string" } }, ["additionalProperties"]),
      },
    ]);
    expect(schema.issues.some((i) => i.level === "error" && i.rule === "schema-changed")).toBe(true);
    expect(schema.rows[0]?.schemaSame).toBe(false);
  });

  it("removable keys are info only", () => {
    const tool: CompatTool = {
      name: "find_daycare",
      inputSchema: {
        ...obj({ a: { anyOf: [{ type: "string", default: "x" }, { type: "null" }] } }, ["a"]),
        additionalProperties: false,
        $schema: "x",
      },
    };
    const r = compatReport([tool]);
    expect(r.issues.filter((i) => i.level === "error")).toEqual([]);
    const infos = r.issues.filter((i) => i.level === "info");
    expect(infos).toHaveLength(1);
    expect(infos[0]?.rule).toBe("schema-stripped");
    expect(infos[0]?.detail).toContain("additionalProperties");
    expect(infos[0]?.detail).toContain("$schema");
    expect(infos[0]?.detail).toContain("default");
  });

  it("stripUnsupported does not mutate", () => {
    const input = { ...obj({ a: { type: "string" } }, []), additionalProperties: false, $schema: "x" };
    const clone = structuredClone(input);
    const { schema } = stripUnsupported(input);
    expect(input).toEqual(clone);
    expect("additionalProperties" in (schema as Record<string, unknown>)).toBe(false);
  });

  it("report text", () => {
    const text = formatCompatReport(compatReport(registryTools()));
    for (const t of allTools) expect(text).toContain(t.name);
    expect(text).toContain("오류 0건");

    const longName = "a".repeat(64 - prefixedName(SERVER_NAME, "").length);
    const synthetic = formatCompatReport(compatReport([{ name: longName, inputSchema: obj({}, []) }]));
    expect(synthetic).toContain("실패");
  });
});
