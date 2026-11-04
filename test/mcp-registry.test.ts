import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Ajv } from "ajv";
import addFormatsModule from "ajv-formats";
import { KEY_ENV } from "../src/core/config.js";
import { VERSION } from "../src/version.js";
import { CLIENT_BRANDS } from "./helpers/visuals.js";
import { NEGATIVE_NOTICE_PATTERNS, NEGATIVE_STEM } from "./helpers/affiliation-wording.js";
import {
  ENV_KEYS,
  PACKAGE_KEYS,
  REPOSITORY,
  SERVER_SCHEMA_SHA256,
  SERVER_SCHEMA_URL,
  TOP_LEVEL_KEYS,
  registryViolations,
} from "./helpers/mcp-registry.js";
import type { RegistryContext, RegistryPkg } from "./helpers/mcp-registry.js";

const addFormats = addFormatsModule.default;

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (rel: string): string => readFileSync(join(root, rel), "utf8");

const serverText = read("server.json");
type Json = Record<string, any>;
const server: Json = JSON.parse(serverText) as Json;
const pkg = JSON.parse(read("package.json")) as RegistryPkg & {
  files: string[];
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const manifest = JSON.parse(read("manifest.json")) as { version: string };
const schemaBytes = readFileSync(join(root, "test/fixtures/mcp-registry/server.schema.json"));
const schema = JSON.parse(schemaBytes.toString("utf8")) as Record<string, unknown>;
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);
const ctx: RegistryContext = {
  pkg,
  manifestVersion: manifest.version,
  version: VERSION,
  keyEnvNames: Object.values(KEY_ENV),
};
const clone = (): Json => JSON.parse(serverText) as Json;

describe("mcp registry server.json", () => {
  beforeAll(() => {
    vi.stubGlobal("fetch", () => {
      throw new Error("global fetch disabled");
    });
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("schema copy is pinned", () => {
    expect(createHash("sha256").update(schemaBytes).digest("hex")).toBe(SERVER_SCHEMA_SHA256);
    expect(schema.$id).toBe(SERVER_SCHEMA_URL);
    expect(schema.$schema).toBe("http://json-schema.org/draft-07/schema#");
  });

  it("server.json passes the official schema", () => {
    expect(validate(server), JSON.stringify(validate.errors)).toBe(true);
    expect(server.$schema).toBe(SERVER_SCHEMA_URL);
  });

  it("identity matches package.json", () => {
    expect(server.name).toBe(pkg.mcpName);
    expect(pkg.mcpName).toBe("io.github.ok0/korean-parenting-mcp");
    expect(server.description).toBe(pkg.description);
    expect(server.repository).toEqual(REPOSITORY);
    expect(Object.keys(server).sort()).toEqual(TOP_LEVEL_KEYS);
    expect(server.packages).toHaveLength(1);
    expect(Object.keys(server.packages[0]).sort()).toEqual(PACKAGE_KEYS);
    expect(server.packages[0].registryType).toBe("npm");
    expect(server.packages[0].identifier).toBe("korean-parenting-mcp");
    expect(server.packages[0].transport).toEqual({ type: "stdio" });
  });

  it("five versions agree", () => {
    expect([server.version, server.packages[0].version, pkg.version, manifest.version, VERSION]).toEqual(
      Array(5).fill(pkg.version),
    );
    expect(registryViolations(server, ctx).filter((v) => v.startsWith("version mismatch"))).toEqual([]);
  });

  it("environment variables mirror KEY_ENV", () => {
    const envs: Json[] = server.packages[0].environmentVariables;
    const names: string[] = envs.map((e) => e.name as string);
    expect([...names].sort()).toEqual([...Object.values(KEY_ENV)].sort());
    expect(names).toHaveLength(4);
    for (const item of envs) {
      expect(item.isSecret, item.name).toBe(true);
      expect(item.isRequired, item.name).toBe(false);
      expect(item.format, item.name).toBe("string");
      expect("default" in item, item.name).toBe(false);
      expect("value" in item, item.name).toBe(false);
      expect(Object.keys(item).sort(), item.name).toEqual(ENV_KEYS);
      expect(item.description, item.name).toMatch(/[가-힣]/);
      expect(item.description, item.name).not.toMatch(/\n/);
      expect(item.description, item.name).toMatch(/쓸 수 있습니다\.$/);
    }
  });

  it("registryViolations is empty for server.json", () => {
    expect(registryViolations(server, ctx)).toEqual([]);
  });

  it("detects synthetic violations", () => {
    const version = clone();
    version.packages[0].version = "9.9.9";
    expect(registryViolations(version, ctx).some((v) => /^version mismatch: server\.json packages\[0\]\.version=9\.9\.9/.test(v))).toBe(true);

    expect(
      registryViolations(server, { ...ctx, pkg: { ...pkg, version: "9.9.9" } }).some((v) =>
        /^version mismatch: package\.json version=9\.9\.9/.test(v),
      ),
    ).toBe(true);

    const name = clone();
    name.name = "io.github.other/korean-parenting-mcp";
    expect(registryViolations(name, ctx).some((v) => v.startsWith("name:"))).toBe(true);

    const missing = clone();
    missing.packages[0].environmentVariables = missing.packages[0].environmentVariables.filter(
      (e: Json) => e.name !== "LAW_OC",
    );
    expect(registryViolations(missing, ctx)).toContain("env missing: LAW_OC");

    const secret = clone();
    secret.packages[0].environmentVariables[0].isSecret = false;
    expect(registryViolations(secret, ctx)).toContain("env DATA_GO_KR_SERVICE_KEY: isSecret must be true");

    const dflt = clone();
    dflt.packages[0].environmentVariables[1].default = "x";
    expect(registryViolations(dflt, ctx).some((v) => v.startsWith("env KINDERGARTEN_API_KEY: fields"))).toBe(true);

    const extra = clone();
    extra.websiteUrl = "https://example.com";
    expect(registryViolations(extra, ctx).some((v) => v.startsWith("fields:"))).toBe(true);

    const schemaBroken = clone();
    delete schemaBroken.description;
    expect(validate(schemaBroken)).toBe(false);
    expect(validate.errors?.some((e) => (e.params as { missingProperty?: string }).missingProperty === "description")).toBe(true);
  });

  it("wording is positive, neutral and key-free", () => {
    for (const re of [...NEGATIVE_NOTICE_PATTERNS, NEGATIVE_STEM]) {
      expect(serverText, String(re)).not.toMatch(re);
    }
    for (const re of CLIENT_BRANDS) {
      expect(serverText, String(re)).not.toMatch(re);
    }
    expect(serverText).not.toMatch(/[A-Za-z0-9+/=%]{32,}/);
    for (const n of Object.values(KEY_ENV)) {
      const v = process.env[n];
      if (v && v.length >= 4) expect(serverText.includes(v), n).toBe(false);
    }
  });

  it("validators are dev-only", () => {
    for (const t of ["ajv", "ajv-formats"]) {
      expect(pkg.devDependencies?.[t], t).toBeDefined();
      expect(Object.keys(pkg.dependencies ?? {}), t).not.toContain(t);
    }
  });

  it("server.json stays out of npm and mcpb packages", () => {
    expect(pkg.files).not.toContain("server.json");
    const packed = JSON.parse(
      execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: root, encoding: "utf8" }),
    ) as { files: { path: string }[] }[];
    expect(packed[0]?.files.map((f) => f.path)).not.toContain("server.json");
    expect(read("scripts/build-mcpb.ts")).not.toContain("server.json");
  }, 60000);

  it("no registry calls in this milestone's code", () => {
    const host = ["registry", "modelcontextprotocol", "io"].join(".");
    const cli = ["mcp", "publisher"].join("-");
    const scriptFiles = readdirSync(join(root, "scripts"), { recursive: true })
      .map((f) => String(f))
      .filter((f) => f.endsWith(".ts"))
      .map((f) => `scripts/${f}`);
    const files = ["test/mcp-registry.test.ts", "test/helpers/mcp-registry.ts", ...scriptFiles];
    for (const f of files) {
      const text = read(f);
      expect(text.includes(host), f).toBe(false);
      expect(text.includes(cli), f).toBe(false);
    }
  });
});
