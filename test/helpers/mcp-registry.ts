export const SERVER_SCHEMA_URL = "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json";
export const SERVER_SCHEMA_SHA256 = "3fba09590c99f61735d234822279f4223fab9e300c0a81e81c91ab62a4114de0";
export const REPOSITORY = { url: "https://github.com/ok0/korean-parenting-mcp", source: "github" } as const;
export const TOP_LEVEL_KEYS: readonly string[] = ["$schema", "description", "name", "packages", "repository", "version"];
export const PACKAGE_KEYS: readonly string[] = ["environmentVariables", "identifier", "registryType", "transport", "version"];
export const ENV_KEYS: readonly string[] = ["description", "format", "isRequired", "isSecret", "name"];
export interface RegistryPkg { name: string; version: string; description: string; mcpName?: string }
export interface RegistryContext { pkg: RegistryPkg; manifestVersion: string; version: string; keyEnvNames: readonly string[] }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i]);

const sortedKeys = (o: Record<string, unknown>): string[] => Object.keys(o).sort();

export function registryViolations(server: unknown, ctx: RegistryContext): string[] {
  if (!isObj(server)) return ["server.json is not an object"];
  const out: string[] = [];

  const keys = sortedKeys(server);
  if (!sameList(keys, TOP_LEVEL_KEYS)) {
    out.push(`fields: top-level keys [${keys.join(", ")}] differ from [${TOP_LEVEL_KEYS.join(", ")}]`);
  }

  if (server.$schema !== SERVER_SCHEMA_URL) {
    out.push(`$schema: ${String(server.$schema)} (expected ${SERVER_SCHEMA_URL})`);
  }

  if (ctx.pkg.mcpName === undefined || server.name !== ctx.pkg.mcpName) {
    out.push(`name: ${String(server.name)} (expected mcpName ${String(ctx.pkg.mcpName)})`);
  }

  if (server.description !== ctx.pkg.description) {
    out.push(`description: ${String(server.description)} (expected package.json description)`);
  }

  const r = server.repository;
  const repoOk =
    isObj(r) &&
    sameList(sortedKeys(r), ["source", "url"]) &&
    r.url === REPOSITORY.url &&
    r.source === REPOSITORY.source;
  if (!repoOk) out.push("repository: url/source differ");

  const pk = server.packages;
  const single = Array.isArray(pk) && pk.length === 1;
  if (!single) out.push("packages: expected exactly 1 entry");
  const p: unknown = single ? pk[0] : undefined;

  if (single && !isObj(p)) out.push("packages[0]: not an object");

  if (single && isObj(p)) {
    const pKeys = sortedKeys(p);
    if (!sameList(pKeys, PACKAGE_KEYS)) {
      out.push(`packages[0] fields: [${pKeys.join(", ")}] differ from [${PACKAGE_KEYS.join(", ")}]`);
    }
    if (p.registryType !== "npm") {
      out.push(`packages[0].registryType: ${String(p.registryType)} (expected npm)`);
    }
    if (p.identifier !== ctx.pkg.name) {
      out.push(`packages[0].identifier: ${String(p.identifier)} (expected ${ctx.pkg.name})`);
    }
    const t = p.transport;
    const transportOk = isObj(t) && sameList(sortedKeys(t), ["type"]) && t.type === "stdio";
    if (!transportOk) out.push('packages[0].transport: expected { type: "stdio" }');
  }

  const sources: [string, unknown][] = [
    ["server.json version", server.version],
    ["server.json packages[0].version", isObj(p) ? p.version : undefined],
    ["package.json version", ctx.pkg.version],
    ["manifest.json version", ctx.manifestVersion],
    ["src/version.ts VERSION", ctx.version],
  ];
  const values = sources.map(([, v]) => v);
  if (!values.every((v) => v === values[0])) {
    const counts = new Map<unknown, number>();
    for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
    let mode: unknown = ctx.pkg.version;
    let best = counts.get(mode) ?? 0;
    for (const [v, c] of counts) {
      if (c > best || (c === best && v === ctx.pkg.version)) {
        mode = v;
        best = c;
      }
    }
    for (const [label, v] of sources) {
      if (v !== mode) out.push(`version mismatch: ${label}=${String(v)} (others ${String(mode)})`);
    }
  }

  if (single && isObj(p)) {
    const envs = p.environmentVariables;
    if (!Array.isArray(envs)) {
      out.push("packages[0].environmentVariables: not an array");
    } else {
      const names: unknown[] = envs.map((e: unknown) => (isObj(e) ? e.name : undefined));
      const known: readonly unknown[] = ctx.keyEnvNames;
      for (const n of ctx.keyEnvNames) {
        if (!names.includes(n)) out.push(`env missing: ${n}`);
      }
      for (const n of names) {
        if (!known.includes(n)) out.push(`env unexpected: ${String(n)}`);
      }
      const seen = new Set<unknown>();
      for (const n of names) {
        if (seen.has(n)) out.push(`env duplicate: ${String(n)}`);
        seen.add(n);
      }
      envs.forEach((e: unknown, i: number) => {
        const label = isObj(e) && e.name !== undefined ? String(e.name) : `#${i}`;
        if (!isObj(e)) {
          out.push(`env ${label}: not an object`);
          return;
        }
        const eKeys = sortedKeys(e);
        if (!sameList(eKeys, ENV_KEYS)) {
          out.push(`env ${label}: fields [${eKeys.join(", ")}] differ from [${ENV_KEYS.join(", ")}]`);
        }
        if (e.isSecret !== true) out.push(`env ${label}: isSecret must be true`);
        if (e.isRequired !== false) out.push(`env ${label}: isRequired must be false`);
        if (e.format !== "string") out.push(`env ${label}: format must be "string"`);
        if (typeof e.description !== "string" || e.description.trim() === "") {
          out.push(`env ${label}: description missing`);
        }
      });
    }
  }

  return out;
}
