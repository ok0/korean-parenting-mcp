import { XMLParser, XMLValidator } from "fast-xml-parser";
import { ToolError } from "../core/errors.js";

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  ignoreDeclaration: true,
  processEntities: true,
});

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function pick(obj: unknown, path: readonly string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (!isRecord(cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

export function asArray(x: unknown): unknown[] {
  if (x === undefined || x === null || x === "") return [];
  if (Array.isArray(x)) return x;
  return [x];
}

export interface ParseOptions {
  jsonDespiteHtmlType?: boolean;
}

export function parseBody(text: string, contentType: string, opts?: ParseOptions): unknown {
  const t = text.replace(/^﻿/, "").trim();

  if (t === "") {
    throw new ToolError("UPSTREAM", "외부 서버가 빈 응답을 보냈습니다", { detail: { reason: "empty" } });
  }

  const looksJson = t[0] === "{" || t[0] === "[";

  if (/^<(!doctype\s+html|html[\s>])/i.test(t) || (contentType.toLowerCase().includes("text/html") && !t.startsWith("<?xml") && !(opts?.jsonDespiteHtmlType === true && looksJson))) {
    throw new ToolError("UPSTREAM", "외부 서버가 데이터 대신 웹 페이지(HTML)를 보냈습니다", { detail: { reason: "html" } });
  }

  const first = t[0];

  if (first === "{" || first === "[") {
    try {
      return JSON.parse(t) as unknown;
    } catch {
      throw new ToolError("UPSTREAM", "외부 서버 응답(JSON)을 해석하지 못했습니다", { detail: { reason: "format" } });
    }
  }

  if (first === "<") {
    if (XMLValidator.validate(t) !== true) {
      throw new ToolError("UPSTREAM", "외부 서버 응답(XML)을 해석하지 못했습니다", { detail: { reason: "format" } });
    }
    return xmlParser.parse(t) as unknown;
  }

  throw new ToolError("UPSTREAM", "외부 서버 응답 형식을 알 수 없습니다", { detail: { reason: "format" } });
}
