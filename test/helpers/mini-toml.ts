export type TomlValue = string | string[] | TomlTable;
export interface TomlTable {
  [key: string]: TomlValue;
}

const TABLE_HEADER = /^\[([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)\]$/;
const KEY_VALUE = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/;
const BASIC_STRING = /^"([^"\\]*)"$/;
const ARRAY_VALUE = /^\[(.*)\]$/;
const ARRAY_ITEM = /^"([^"\\,]*)"$/;

function fail(lineNo: number, reason: string): never {
  throw new Error(`mini-toml: line ${lineNo}: ${reason}`);
}

function stripComment(line: string): string {
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuote = !inQuote;
    } else if (ch === "#" && !inQuote) {
      return line.slice(0, i).trim();
    }
  }
  return line.trim();
}

function isTable(value: TomlValue | undefined): value is TomlTable {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseValue(raw: string, lineNo: number): TomlValue {
  const str = BASIC_STRING.exec(raw);
  if (str) {
    const body = str[1] ?? "";
    if (body.includes("\\")) fail(lineNo, "escapes are not supported");
    return body;
  }
  const arr = ARRAY_VALUE.exec(raw);
  if (arr) {
    const inner = (arr[1] ?? "").trim();
    if (inner === "") return [];
    return inner.split(",").map((part) => {
      const item = ARRAY_ITEM.exec(part.trim());
      if (!item) fail(lineNo, "unsupported array item");
      return item[1] ?? "";
    });
  }
  return fail(lineNo, "unsupported value");
}

export function parseMiniToml(src: string): TomlTable {
  const root: TomlTable = {};
  const declared = new Set<string>();
  let current: TomlTable = root;

  src.split(/\r?\n/).forEach((rawLine, index) => {
    const lineNo = index + 1;
    const line = stripComment(rawLine);
    if (line === "") return;

    if (line.startsWith("[[")) fail(lineNo, "array of tables is not supported");

    const header = TABLE_HEADER.exec(line);
    if (header) {
      const path = header[1] ?? "";
      if (declared.has(path)) fail(lineNo, `duplicate table [${path}]`);
      declared.add(path);
      let node: TomlTable = root;
      for (const segment of path.split(".")) {
        const existing = node[segment];
        if (existing === undefined) {
          const created: TomlTable = {};
          node[segment] = created;
          node = created;
        } else if (isTable(existing)) {
          node = existing;
        } else {
          fail(lineNo, `[${path}] conflicts with a non-table value`);
        }
      }
      current = node;
      return;
    }

    const pair = KEY_VALUE.exec(line);
    if (pair) {
      const key = pair[1] ?? "";
      if (Object.prototype.hasOwnProperty.call(current, key)) {
        fail(lineNo, `duplicate key "${key}"`);
      }
      current[key] = parseValue((pair[2] ?? "").trim(), lineNo);
      return;
    }

    fail(lineNo, "unsupported line");
  });

  return root;
}
