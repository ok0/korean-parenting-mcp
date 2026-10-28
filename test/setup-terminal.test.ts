import { PassThrough, Writable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  SetupAbortError,
  createLineReader,
  createTerminalIO,
  defaultExec,
  type LineInput,
} from "../src/setup/terminal.js";

function capture(): { stream: Writable; text: () => string } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(String(chunk));
      cb();
    },
  });
  return { stream, text: () => chunks.join("") };
}

async function rejectionOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  return undefined;
}

describe("createLineReader", () => {
  it("masks secret input and handles backspace", async () => {
    const input = new PassThrough();
    const out = capture();
    const reader = createLineReader(input, out.stream);
    input.write("abc\x7fd\r");
    const line = await reader.read("", { mask: true });
    reader.close();
    expect(line).toBe("abd");
    const text = out.text();
    expect(text).toContain("\b \b");
    expect(text).toContain("*");
    expect(text).not.toContain("abc");
    expect(text).not.toContain("abd");
  });

  it("echoes plain input", async () => {
    const input = new PassThrough();
    const out = capture();
    const reader = createLineReader(input, out.stream);
    input.write("12\n");
    const line = await reader.read("", { mask: false });
    reader.close();
    expect(line).toBe("12");
    expect(out.text()).toContain("12");
  });

  it("keeps buffered lines across reads", async () => {
    const input = new PassThrough();
    const out = capture();
    const reader = createLineReader(input, out.stream);
    input.write("one\r\ntwo\n");
    const first = await reader.read("", { mask: false });
    const second = await reader.read("", { mask: false });
    reader.close();
    expect(first).toBe("one");
    expect(second).toBe("two");
  });

  it("strips bracketed paste markers", async () => {
    const input = new PassThrough();
    const out = capture();
    const reader = createLineReader(input, out.stream);
    input.write("\x1b[200~s3cr3t-paste\x1b[201~\r");
    const line = await reader.read("", { mask: true });
    reader.close();
    expect(line).toBe("s3cr3t-paste");
    expect(out.text()).not.toContain("s3cr3t-paste");
  });

  it("rejects on ctrl-c and on end", async () => {
    const interruptInput = new PassThrough();
    const interruptReader = createLineReader(interruptInput, capture().stream);
    interruptInput.write("\x03");
    const interrupt = await rejectionOf(interruptReader.read("", { mask: false }));
    interruptReader.close();
    expect(interrupt).toBeInstanceOf(SetupAbortError);
    expect((interrupt as SetupAbortError).reason).toBe("interrupt");

    const endInput = new PassThrough();
    const endReader = createLineReader(endInput, capture().stream);
    const pending = rejectionOf(endReader.read("", { mask: false }));
    endInput.end();
    const eof = await pending;
    endReader.close();
    expect(eof).toBeInstanceOf(SetupAbortError);
    expect((eof as SetupAbortError).reason).toBe("eof");
  });

  it("toggles raw mode only on tty", async () => {
    const input = new PassThrough();
    const setRawMode = vi.fn();
    Object.assign(input, { isTTY: true, setRawMode });
    const reader = createLineReader(input as LineInput, capture().stream);
    input.write("a\r");
    await reader.read("", { mask: false });
    expect(setRawMode).toHaveBeenCalledWith(true);
    reader.close();
    expect(setRawMode).toHaveBeenLastCalledWith(false);
  });

  it("non-interactive io attaches no stdin listeners", () => {
    const input = new PassThrough();
    createTerminalIO({
      input,
      output: capture().stream,
      errOutput: capture().stream,
      interactive: false,
    });
    expect(input.listenerCount("data")).toBe(0);
  });
});

describe("defaultExec", () => {
  it("defaultExec reports notFound", async () => {
    const result = await defaultExec("kpm-missing-cmd-zz9", []);
    expect(result.notFound).toBe(true);
  });

  it("defaultExec returns exit code and stderr", async () => {
    const result = await defaultExec(process.execPath, [
      "-e",
      "process.stderr.write('x');process.exit(3)",
    ]);
    expect(result.code).toBe(3);
    expect(result.stderr).toBe("x");
    expect(result.notFound).toBe(false);
  });
});
