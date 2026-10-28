import { describe, expect, it } from "vitest";
import { asArray, parseBody, pick } from "../src/clients/parse.js";
import { ToolError } from "../src/core/errors.js";

function expectUpstream(fn: () => unknown, reason: string): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ToolError);
    expect((err as ToolError).kind).toBe("UPSTREAM");
    expect((err as ToolError).detail?.reason).toBe(reason);
    return;
  }
  throw new Error("expected ToolError");
}

describe("parseBody", () => {
  it("parses XML with string values and attributes prefixed", () => {
    const parsed = parseBody("<r><items><item><zip>0123</zip><n>7</n></item></items></r>", "application/xml");
    expect(pick(parsed, ["r", "items", "item", "zip"])).toBe("0123");
    expect(pick(parsed, ["r", "items", "item", "n"])).toBe("7");
  });

  it("parses JSON with leading whitespace", () => {
    expect(parseBody("  \n{\"a\":[1]}", "application/json")).toEqual({ a: [1] });
  });

  it("treats XML declared as text/html as XML when it starts with <?xml", () => {
    expect(parseBody("<?xml version=\"1.0\"?><r>1</r>", "text/html")).toEqual({ r: "1" });
  });

  it("rejects empty bodies", () => {
    expectUpstream(() => parseBody("", "application/json"), "empty");
    expectUpstream(() => parseBody("   ", "application/json"), "empty");
  });

  it("rejects HTML bodies", () => {
    expectUpstream(() => parseBody("<!DOCTYPE html><html></html>", "text/plain"), "html");
    expectUpstream(() => parseBody("<div>x</div>", "text/html; charset=utf-8"), "html");
  });

  it("rejects malformed JSON, malformed XML, and unknown formats", () => {
    expectUpstream(() => parseBody("{", "application/json"), "format");
    expectUpstream(() => parseBody("<a><b></a>", "application/xml"), "format");
    expectUpstream(() => parseBody("plain text", "text/plain"), "format");
  });
});

describe("pick", () => {
  it("returns undefined when a step is not a record", () => {
    expect(pick({ a: { b: 1 } }, ["a", "c"])).toBeUndefined();
    expect(pick({ a: 1 }, ["a", "b"])).toBeUndefined();
  });
});

describe("asArray", () => {
  it("normalizes missing, array, and single values", () => {
    expect(asArray(undefined)).toEqual([]);
    expect(asArray(null)).toEqual([]);
    expect(asArray("")).toEqual([]);
    expect(asArray({ a: 1 })).toEqual([{ a: 1 }]);
    expect(asArray([1, 2])).toEqual([1, 2]);
  });
});
