import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { KeyEnvName } from "../../src/core/config.js";
import {
  SetupAbortError,
  type ExecResult,
  type SetupIO,
} from "../../src/setup/terminal.js";
import {
  nodeFs,
  type RunSetupOptions,
  type SetupFs,
} from "../../src/setup/setup.js";

export interface FakeIO extends SetupIO {
  outLines: string[];
  errLines: string[];
  prompts: { question: string; mask: boolean }[];
  execCalls: { cmd: string; args: string[] }[];
  closed: boolean;
}

export function createFakeIO(o: {
  answers: string[];
  interactive?: boolean;
  exec?: (cmd: string, args: readonly string[]) => ExecResult | Promise<ExecResult>;
}): FakeIO {
  const answers = [...o.answers];
  const io: FakeIO = {
    interactive: o.interactive ?? true,
    outLines: [],
    errLines: [],
    prompts: [],
    execCalls: [],
    closed: false,
    out(text) {
      io.outLines.push(text);
    },
    err(text) {
      io.errLines.push(text);
    },
    async prompt(question, opts) {
      io.prompts.push({ question, mask: opts.mask });
      const answer = answers.shift();
      if (answer === undefined) throw new SetupAbortError("eof");
      return answer;
    },
    exec: async (cmd: string, args: readonly string[]) => {
      io.execCalls.push({ cmd, args: [...args] });
      if (o.exec) return o.exec(cmd, args);
      return {
        code: 0,
        stdout: args[0] === "--version" ? "1.0.0" : "",
        stderr: "",
        notFound: false,
      };
    },
    close() {
      io.closed = true;
    },
  };
  return io;
}

export function createRecordingFs(
  root: string,
  o: { failChmod?: boolean } = {},
): SetupFs & { touched: string[] } {
  const touched: string[] = [];
  return {
    touched,
    readFile(p) {
      touched.push(p);
      return nodeFs.readFile(p);
    },
    writeFile(p, data, opts) {
      touched.push(p);
      return nodeFs.writeFile(p, data, opts);
    },
    copyFile(src, dst) {
      touched.push(src, dst);
      return nodeFs.copyFile(src, dst);
    },
    mkdir(p, opts) {
      touched.push(p);
      return nodeFs.mkdir(p, opts);
    },
    chmod(p, mode) {
      touched.push(p);
      if (o.failChmod) {
        return Promise.reject(Object.assign(new Error("EPERM"), { code: "EPERM" }));
      }
      return nodeFs.chmod(p, mode);
    },
    exists(p) {
      touched.push(p);
      return nodeFs.exists(p);
    },
  };
}

export async function listAll(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (abs: string, rel: string): Promise<void> => {
    for (const ent of await readdir(abs, { withFileTypes: true })) {
      const next = rel === "" ? ent.name : `${rel}/${ent.name}`;
      if (ent.isDirectory()) await walk(join(abs, ent.name), next);
      else out.push(next);
    }
  };
  await walk(dir, "");
  return out;
}

export const FAKE_KEYS: Record<KeyEnvName, string> = {
  DATA_GO_KR_SERVICE_KEY: "dg+Fake/Key=0001abcd",
  KINDERGARTEN_API_KEY: "kg+Fake/Key=0002efgh",
  LAW_OC: "lo+Fake/Key=0003ijkl",
  SAFETYKOREA_AUTH_KEY: "sk+Fake/Key=0004mnop",
};

export function setupOpts(home: string, io: SetupIO, fs: SetupFs): RunSetupOptions {
  return {
    io,
    fs,
    env: { KPM_SETUP_HOME: home },
    platform: "darwin",
    homedir: () => {
      throw new Error("real home must not be used");
    },
  };
}

export const desktopFile = (home: string): string =>
  join(home, "Library/Application Support/Claude/claude_desktop_config.json");
