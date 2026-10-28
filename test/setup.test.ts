import { mkdtemp, mkdir, readFile, rm, stat, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KEY_ENV, type KeyEnvName, type KeyName } from "../src/core/config.js";
import { KEY_GUIDE } from "../src/core/errors.js";
import { ARGS_NOTICE, RESTART_NOTICE, runSetup } from "../src/setup/setup.js";
import { createTerminalIO } from "../src/setup/terminal.js";
import {
  FAKE_KEYS,
  createFakeIO,
  createRecordingFs,
  desktopFile,
  listAll,
  setupOpts,
} from "./helpers/setup-io.js";

const KEY_NAMES = Object.values(KEY_ENV) as KeyEnvName[];

let home: string;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "kpm-setup-"));
  fetchMock = vi.fn(() => {
    throw new Error("network disabled");
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await rm(home, { recursive: true, force: true });
});

function allKeyAnswers(): string[] {
  return KEY_NAMES.map((k, i) => (i % 2 === 0 ? ` ${FAKE_KEYS[k]} ` : FAKE_KEYS[k]));
}

async function writeDesktop(content: string, mode?: number): Promise<string> {
  const file = desktopFile(home);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
  if (mode !== undefined) await chmod(file, mode);
  return file;
}

async function readServers(file: string): Promise<Record<string, unknown>> {
  const parsed = JSON.parse(await readFile(file, "utf8")) as { mcpServers: Record<string, unknown> };
  return parsed.mcpServers;
}

const ENTRY_NAME = "korean-parenting";

describe("setup wizard", () => {
  it("AC1 all keys go into env", async () => {
    const io = createFakeIO({ answers: [...allKeyAnswers(), "1"] });
    const code = await runSetup(setupOpts(home, io, createRecordingFs(home)));

    expect(code).toBe(0);
    const servers = await readServers(desktopFile(home));
    expect(servers[ENTRY_NAME]).toEqual({
      command: "npx",
      args: ["-y", "korean-parenting-mcp"],
      env: FAKE_KEYS,
    });

    const masked = io.prompts.filter((p) => p.mask);
    expect(masked.length).toBe(KEY_NAMES.length);
    KEY_NAMES.forEach((k, i) => {
      expect(masked[i]?.question).toContain(k);
    });

    const out = io.outLines.join("\n");
    for (const k of Object.keys(KEY_ENV) as KeyName[]) {
      expect(out).toContain(KEY_GUIDE[k].title);
    }
  });

  it("AC1 partial and none", async () => {
    const partial = createFakeIO({
      answers: ["", FAKE_KEYS.KINDERGARTEN_API_KEY, "   ", ` ${FAKE_KEYS.SAFETYKOREA_AUTH_KEY} `, "1"],
    });
    expect(await runSetup(setupOpts(home, partial, createRecordingFs(home)))).toBe(0);
    const partialEnv = (await readServers(desktopFile(home)))[ENTRY_NAME] as { env: Record<string, string> };
    expect(Object.keys(partialEnv.env)).toEqual(["KINDERGARTEN_API_KEY", "SAFETYKOREA_AUTH_KEY"]);
    expect(partialEnv.env.KINDERGARTEN_API_KEY).toBe(FAKE_KEYS.KINDERGARTEN_API_KEY);
    expect(partialEnv.env.SAFETYKOREA_AUTH_KEY).toBe(FAKE_KEYS.SAFETYKOREA_AUTH_KEY);

    await rm(desktopFile(home), { force: true });
    const none = createFakeIO({ answers: ["", "", "", "", "1"] });
    expect(await runSetup(setupOpts(home, none, createRecordingFs(home)))).toBe(0);
    const noneEntry = (await readServers(desktopFile(home)))[ENTRY_NAME] as { env: Record<string, string> };
    expect(noneEntry.env).toEqual({});
  });

  it("AC2 preserves other entries and top-level keys", async () => {
    const original = `{"globalShortcut":"Cmd+K","mcpServers":{"other":{"command":"node","args":["x.js"],"env":{"TOKEN":"keep-me"}}}}`;
    await writeDesktop(original);
    const io = createFakeIO({ answers: [...allKeyAnswers(), "1"] });
    expect(await runSetup(setupOpts(home, io, createRecordingFs(home)))).toBe(0);

    const parsed = JSON.parse(await readFile(desktopFile(home), "utf8")) as Record<string, unknown>;
    const originalParsed = JSON.parse(original) as { globalShortcut: unknown; mcpServers: Record<string, unknown> };
    expect(parsed.globalShortcut).toBe(originalParsed.globalShortcut);
    expect((parsed.mcpServers as Record<string, unknown>).other).toEqual(originalParsed.mcpServers.other);
    expect((parsed.mcpServers as Record<string, unknown>)[ENTRY_NAME]).toBeDefined();
    expect(io.outLines.join("\n")).toContain("- Claude Desktop: 기록됨");
  });

  it("AC2 replaces same-name entry with notice", async () => {
    await writeDesktop(JSON.stringify({ mcpServers: { [ENTRY_NAME]: { command: "old" } } }));
    const io = createFakeIO({ answers: [...allKeyAnswers(), "1"] });
    expect(await runSetup(setupOpts(home, io, createRecordingFs(home)))).toBe(0);

    const servers = await readServers(desktopFile(home));
    expect((servers[ENTRY_NAME] as { command: string }).command).toBe("npx");
    const out = io.outLines.join("\n");
    expect(out).toContain("교체했습니다");
    expect(out).toContain("- Claude Desktop: 교체됨");
  });

  it("AC2 creates file and directories", async () => {
    const io = createFakeIO({ answers: [...allKeyAnswers(), "1"] });
    const fs = createRecordingFs(home);
    expect(await runSetup(setupOpts(home, io, fs))).toBe(0);

    const servers = await readServers(desktopFile(home));
    expect(servers[ENTRY_NAME]).toBeDefined();
    expect(fs.touched.length).toBeGreaterThan(0);
    expect(fs.touched.every((p) => p.startsWith(home))).toBe(true);
  });

  it.each(["{ not json", "[1,2]"])("AC3 invalid desktop config %s is left untouched and flow continues", async (content) => {
    const file = await writeDesktop(content);
    const before = await readFile(file);
    const io = createFakeIO({ answers: [...allKeyAnswers(), "1,2"] });
    const code = await runSetup(setupOpts(home, io, createRecordingFs(home)));

    expect(await readFile(file)).toEqual(before);
    expect((await listAll(home)).some((f) => f.endsWith(".bak"))).toBe(false);
    const err = io.errLines.join("\n");
    expect(err).toContain("수정하지 않았습니다");
    expect(err).toContain(file);
    expect(io.execCalls.some((c) => c.args[0] === "mcp")).toBe(true);
    expect(io.outLines.join("\n")).toContain("- Claude Code: 등록됨");
    expect(code).toBe(1);
  });

  it.skipIf(process.platform === "win32")("AC4 backup and 0o600", async () => {
    const original = `{"theme":"dark"}`;
    const file = await writeDesktop(original, 0o644);
    const io = createFakeIO({ answers: [...allKeyAnswers(), "1"] });
    expect(await runSetup(setupOpts(home, io, createRecordingFs(home)))).toBe(0);

    expect(await readFile(`${file}.bak`, "utf8")).toBe(original);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect((await stat(`${file}.bak`)).mode & 0o777).toBe(0o600);
  });

  it("AC4 chmod failure keeps write and warns", async () => {
    const io = createFakeIO({ answers: [...allKeyAnswers(), "1"] });
    const code = await runSetup(setupOpts(home, io, createRecordingFs(home, { failChmod: true })));

    const servers = await readServers(desktopFile(home));
    expect(servers[ENTRY_NAME]).toBeDefined();
    expect(io.errLines.join("\n")).toContain("권한(0o600)");
    expect(code).toBe(0);
  });

  it("AC5 claude args array", async () => {
    const io = createFakeIO({
      answers: [FAKE_KEYS.DATA_GO_KR_SERVICE_KEY, "", "", FAKE_KEYS.SAFETYKOREA_AUTH_KEY, "2"],
    });
    const code = await runSetup(setupOpts(home, io, createRecordingFs(home)));

    expect(io.execCalls[0]).toEqual({ cmd: "claude", args: ["--version"] });
    const add = io.execCalls[1];
    expect(add?.cmd).toBe("claude");
    expect(Array.isArray(add?.args)).toBe(true);
    expect(add?.args).toEqual([
      "mcp",
      "add",
      "--transport",
      "stdio",
      "--scope",
      "user",
      "--env",
      `DATA_GO_KR_SERVICE_KEY=${FAKE_KEYS.DATA_GO_KR_SERVICE_KEY}`,
      "--env",
      `SAFETYKOREA_AUTH_KEY=${FAKE_KEYS.SAFETYKOREA_AUTH_KEY}`,
      "korean-parenting",
      "--",
      "npx",
      "-y",
      "korean-parenting-mcp",
    ]);
    expect(await listAll(home)).toEqual([]);
    expect(code).toBe(0);
  });

  it("AC5 no --env when no keys are entered", async () => {
    const io = createFakeIO({ answers: ["", "", "", "", "2"] });
    await runSetup(setupOpts(home, io, createRecordingFs(home)));

    const add = io.execCalls[1];
    expect(add?.args).not.toContain("--env");
    expect(add?.args).toContain("korean-parenting");
  });

  it("AC6 claude not found prints placeholder command", async () => {
    const io = createFakeIO({
      answers: [FAKE_KEYS.DATA_GO_KR_SERVICE_KEY, "", "", "", "2"],
      exec: (_cmd, args) =>
        args[0] === "--version"
          ? { code: null, stdout: "", stderr: "", notFound: true }
          : { code: 0, stdout: "", stderr: "", notFound: false },
    });
    const code = await runSetup(setupOpts(home, io, createRecordingFs(home)));

    expect(io.execCalls.some((c) => c.args[0] === "mcp")).toBe(false);
    const out = io.outLines.join("\n");
    expect(out).toContain(`--env "DATA_GO_KR_SERVICE_KEY=<DATA_GO_KR_SERVICE_KEY>"`);
    expect(out).not.toContain("<LAW_OC>");
    expect(out + io.errLines.join("\n")).not.toContain(FAKE_KEYS.DATA_GO_KR_SERVICE_KEY);
    expect(out).toContain("- Claude Code: 실패");
    expect(code).toBe(1);
  });

  it("AC6 claude failure masks executor output", async () => {
    const io = createFakeIO({
      answers: [FAKE_KEYS.DATA_GO_KR_SERVICE_KEY, "", "", "", "1,2"],
      exec: (_cmd, args) =>
        args[0] === "--version"
          ? { code: 0, stdout: "1.0.0", stderr: "", notFound: false }
          : {
              code: 1,
              stdout: "",
              stderr: `error: server exists ${FAKE_KEYS.DATA_GO_KR_SERVICE_KEY}`,
              notFound: false,
            },
    });
    const code = await runSetup(setupOpts(home, io, createRecordingFs(home)));

    const err = io.errLines.join("\n");
    expect(err).toContain("***");
    expect(err).not.toContain(FAKE_KEYS.DATA_GO_KR_SERVICE_KEY);
    expect(err).toContain("claude mcp remove korean-parenting --scope user");
    const out = io.outLines.join("\n");
    expect(out).toContain(RESTART_NOTICE);
    expect(out).toContain(ARGS_NOTICE);
    expect(code).toBe(1);
  });

  it("AC7 no key leaks across all flows", async () => {
    const ok = { code: 0, stdout: "1.0.0", stderr: "", notFound: false };
    const leaky = (_cmd: string, args: readonly string[]) =>
      args[0] === "--version"
        ? ok
        : {
            code: 1,
            stdout: KEY_NAMES.map((k) => encodeURIComponent(FAKE_KEYS[k])).join(" "),
            stderr: KEY_NAMES.map((k) => FAKE_KEYS[k]).join(" "),
            notFound: false,
          };
    const flows: { answers: string[]; exec?: typeof leaky }[] = [
      { answers: [...allKeyAnswers(), "1,2"] },
      { answers: [...allKeyAnswers(), "x", "1,2"] },
      { answers: [...allKeyAnswers(), "2"], exec: leaky },
      { answers: [...allKeyAnswers(), ""] },
    ];

    for (const flow of flows) {
      const captured: string[] = [];
      const sink = (): Writable =>
        new Writable({
          write(chunk, _enc, cb) {
            captured.push(String(chunk));
            cb();
          },
        });
      const outStream = sink();
      const errStream = sink();
      const input = new PassThrough();
      input.write(flow.answers.join("\r") + "\r");

      const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      const io = createTerminalIO({
        input,
        output: outStream,
        errOutput: errStream,
        exec: async (cmd, args) => (flow.exec ? flow.exec(cmd, args) : ok),
        interactive: true,
      });
      await runSetup(setupOpts(home, io, createRecordingFs(home)));

      const output = captured.join("");
      const everything = [
        output,
        ...stdoutSpy.mock.calls.map((c) => String(c[0])),
        ...stderrSpy.mock.calls.map((c) => String(c[0])),
      ].join("");
      for (const k of Object.values(FAKE_KEYS)) {
        expect(everything).not.toContain(k);
        expect(everything).not.toContain(encodeURIComponent(k));
      }
      expect(output).toContain("*");
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  it("AC8 non-interactive writes nothing", async () => {
    const io = createFakeIO({ answers: [], interactive: false });
    const fs = createRecordingFs(home);
    expect(await runSetup(setupOpts(home, io, fs))).toBe(2);

    expect(io.errLines.join("\n")).toContain("대화형 터미널");
    expect(fs.touched).toEqual([]);
    expect(io.execCalls).toEqual([]);
    expect(io.prompts).toEqual([]);
    expect(await listAll(home)).toEqual([]);
  });

  it("AC8 no target selected exits 0 without writing", async () => {
    const io = createFakeIO({ answers: ["", "", "", "", ""] });
    expect(await runSetup(setupOpts(home, io, createRecordingFs(home)))).toBe(0);

    expect(await listAll(home)).toEqual([]);
    expect(io.execCalls.some((c) => c.args[0] === "mcp")).toBe(false);
    expect(io.outLines.join("\n")).toContain("아무것도 기록하지");
  });

  it("abort before writing", async () => {
    const io = createFakeIO({ answers: ["", ""] });
    expect(await runSetup(setupOpts(home, io, createRecordingFs(home)))).toBe(130);

    expect(await listAll(home)).toEqual([]);
    expect(io.closed).toBe(true);
  });
});
