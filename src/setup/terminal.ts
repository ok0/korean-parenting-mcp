import { execFile } from "node:child_process";

export class SetupAbortError extends Error {
  constructor(readonly reason: "interrupt" | "eof") {
    super(`setup aborted: ${reason}`);
    this.name = "SetupAbortError";
  }
}

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  notFound: boolean;
}

export type Exec = (cmd: string, args: readonly string[]) => Promise<ExecResult>;

export interface SetupIO {
  readonly interactive: boolean;
  out(text: string): void;
  err(text: string): void;
  prompt(question: string, opts: { mask: boolean }): Promise<string>;
  exec: Exec;
  close(): void;
}

export type LineInput = NodeJS.ReadableStream & {
  isTTY?: boolean;
  setRawMode?: (mode: boolean) => unknown;
};

export function createLineReader(
  input: LineInput,
  output: NodeJS.WritableStream,
): {
  read(prompt: string, opts: { mask: boolean }): Promise<string>;
  close(): void;
} {
  const queue: string[] = [];
  let attached = false;
  let ended = false;
  let closed = false;
  let rawOn = false;
  let afterCr = false;
  let escState: 0 | 1 | 2 = 0;
  let wake: (() => void) | undefined;

  const onData = (chunk: Buffer | string): void => {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    for (const ch of text) queue.push(ch);
    wake?.();
    wake = undefined;
  };

  const onEnd = (): void => {
    ended = true;
    wake?.();
    wake = undefined;
  };

  const attach = (): void => {
    if (attached) return;
    attached = true;
    input.on("data", onData);
    input.on("end", onEnd);
    if (input.isTTY && input.setRawMode) {
      input.setRawMode(true);
      rawOn = true;
    }
    input.resume();
  };

  return {
    async read(prompt, opts) {
      attach();
      output.write(prompt);
      const line: string[] = [];
      for (;;) {
        const ch = queue.shift();
        if (ch === undefined) {
          if (ended || closed) throw new SetupAbortError("eof");
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          continue;
        }
        if (afterCr) {
          afterCr = false;
          if (ch === "\n") continue;
        }
        if (escState === 1) {
          if (ch === "[") {
            escState = 2;
            continue;
          }
          escState = 0;
        }
        if (escState === 2) {
          if (/[@-~]/.test(ch)) escState = 0;
          continue;
        }
        if (ch === "\x1b") {
          escState = 1;
          continue;
        }
        if (ch === "\r" || ch === "\n") {
          afterCr = ch === "\r";
          output.write("\n");
          return line.join("");
        }
        if (ch === "\x03") throw new SetupAbortError("interrupt");
        if (ch === "\x04") {
          if (line.length === 0) throw new SetupAbortError("eof");
          continue;
        }
        if (ch === "\x7f" || ch === "\b") {
          if (line.length > 0) {
            line.pop();
            output.write("\b \b");
          }
          continue;
        }
        if (ch.charCodeAt(0) < 0x20) continue;
        line.push(ch);
        output.write(opts.mask ? "*" : ch);
      }
    },
    close(): void {
      if (closed) return;
      closed = true;
      if (rawOn && input.setRawMode) {
        input.setRawMode(false);
        rawOn = false;
      }
      if (attached) {
        input.removeListener("data", onData);
        input.removeListener("end", onEnd);
      }
      input.pause();
      wake?.();
      wake = undefined;
    },
  };
}

export function defaultExec(cmd: string, args: readonly string[]): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      [...args],
      { shell: false, windowsHide: true, timeout: 60000, maxBuffer: 1 << 20, encoding: "utf8" },
      (err, stdout, stderr) => {
        if (!err) {
          resolve({ code: 0, stdout, stderr, notFound: false });
          return;
        }
        const code: unknown = (err as { code?: unknown }).code;
        if (code === "ENOENT") {
          resolve({ code: null, stdout: "", stderr: "", notFound: true });
          return;
        }
        resolve({
          code: typeof code === "number" ? code : 1,
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
          notFound: false,
        });
      },
    );
  });
}

export function createTerminalIO(
  opts: {
    input?: LineInput;
    output?: NodeJS.WritableStream;
    errOutput?: NodeJS.WritableStream;
    exec?: Exec;
    interactive?: boolean;
  } = {},
): SetupIO {
  const input: LineInput = opts.input ?? process.stdin;
  const output: NodeJS.WritableStream = opts.output ?? process.stdout;
  const errOutput: NodeJS.WritableStream = opts.errOutput ?? process.stderr;
  const exec: Exec = opts.exec ?? defaultExec;
  const interactive =
    opts.interactive ?? (input.isTTY === true && typeof input.setRawMode === "function");
  let reader: ReturnType<typeof createLineReader> | undefined;
  return {
    interactive,
    out(text) {
      output.write(text + "\n");
    },
    err(text) {
      errOutput.write(text + "\n");
    },
    prompt(question, o) {
      reader ??= createLineReader(input, output);
      return reader.read(question, o);
    },
    exec,
    close() {
      reader?.close();
    },
  };
}
