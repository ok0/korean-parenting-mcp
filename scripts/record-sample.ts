import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { LAW_BASE } from "../src/clients/law.js";
import { SPECS } from "../src/clients/data-go-kr-specs.js";
import { formatDate, todayKst } from "../src/date/civil-date.js";
import { EXIT, isMainModule, processIO, type ScriptIO } from "./lib/script-io.js";
import {
  findLeaks,
  KEY_ENV_NAMES,
  MASK,
  maskSample,
  PLACEHOLDER_KEY,
  secretsFromEnv,
  summarize,
  trimItems,
  type SampleFormat,
} from "./lib/sample-mask.js";

const USAGE =
  "사용법: node build-scripts/scripts/record-sample.js <target> [name=value ...] [--name <id>] [--base <url>] [--op <operation>] [--max-items <n>] [--items-key <key>] [--key-env <NAME>] [--key-param <name>] [--note <path>] [--out-file <abs path>] [--raw-out <abs path>] [--timeout-ms <n>] [--bad-key] [--service] [--force] [--no-save]";

const VALUE_FLAGS = [
  "--name",
  "--base",
  "--op",
  "--max-items",
  "--items-key",
  "--key-env",
  "--key-param",
  "--note",
  "--out-file",
  "--raw-out",
  "--timeout-ms",
] as const;
const BOOL_FLAGS = ["--bad-key", "--service", "--force", "--no-save"] as const;
const LAW_TARGETS = ["admrul", "licbyl", "law", "lawjosub"] as const;
const ALLOWED_BASE_HOSTS = ["apis.data.go.kr", "api.odcloud.kr"];
const EXT_BY_FORMAT: Record<SampleFormat, string> = { xml: "xml", json: "json", html: "html", text: "txt" };
const FIXTURE_EXTS = ["xml", "json", "html", "txt"];

interface Request {
  label: string;
  url: string;
  keyParam: string;
  keyEnv: string;
  folder?: string;
}

function isUnder(dir: string, p: string): boolean {
  const rel = relative(dir, p);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return false;
  return true;
}

function isOutsideRoot(root: string, p: string): boolean {
  const rel = relative(root, p);
  return rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
}

function isHttpsUrl(raw: string): URL | undefined {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" ? u : undefined;
  } catch {
    return undefined;
  }
}

export async function main(
  argv: readonly string[],
  io: ScriptIO,
  deps?: { root?: string; mask?: (t: string, s: readonly string[]) => string },
): Promise<number> {
  const root = deps?.root ?? process.cwd();
  const mask = deps?.mask ?? maskSample;
  const secrets = [...secretsFromEnv(io.env), PLACEHOLDER_KEY];
  const say = (text: string): void => io.stdout(maskSample(text, secrets));
  const complain = (text: string): void => io.stderr(maskSample(text, secrets));
  const usage = (msg: string): number => {
    complain(`${USAGE}\n${msg}\n`);
    return EXIT.USAGE;
  };

  const values: Record<string, string> = {};
  const bools = new Set<string>();
  const params: [string, string][] = [];
  let target: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i] ?? "";
    if (tok.startsWith("--")) {
      if ((BOOL_FLAGS as readonly string[]).includes(tok)) {
        bools.add(tok);
        continue;
      }
      if ((VALUE_FLAGS as readonly string[]).includes(tok)) {
        const v = argv[i + 1];
        if (v === undefined) return usage(`값이 없는 옵션: ${tok}`);
        values[tok] = v;
        i++;
        continue;
      }
      return usage(`알 수 없는 옵션: ${tok}`);
    }
    if (target === undefined) {
      target = tok;
      continue;
    }
    const eq = tok.indexOf("=");
    if (eq <= 0) return usage(`파라미터는 name=value 형식이어야 합니다: ${tok}`);
    params.push([tok.slice(0, eq), tok.slice(eq + 1)]);
  }
  if (target === undefined) return usage("target이 없습니다");

  const name = values["--name"];
  if (name !== undefined && !/^[a-z0-9][a-z0-9-]*$/.test(name)) return usage("--name은 ^[a-z0-9][a-z0-9-]*$ 형식이어야 합니다");
  const maxRaw = values["--max-items"] ?? "3";
  if (!/^\d+$/.test(maxRaw)) return usage("--max-items는 0 이상의 정수여야 합니다");
  const maxItems = Number(maxRaw);
  const itemsKey = values["--items-key"] ?? "item";
  const timeoutRaw = values["--timeout-ms"] ?? "20000";
  if (!/^\d+$/.test(timeoutRaw) || Number(timeoutRaw) <= 0) return usage("--timeout-ms는 양의 정수여야 합니다");
  const timeoutMs = Number(timeoutRaw);
  const badKey = bools.has("--bad-key");
  const noSave = bools.has("--no-save");
  const force = bools.has("--force");
  const outFileRaw = values["--out-file"];
  const rawOutRaw = values["--raw-out"];
  const noteRaw = values["--note"];

  let req: Request;
  let needsFolder = false;
  if (target.startsWith("url:")) {
    const base = isHttpsUrl(target.slice("url:".length));
    if (!base) return usage("url: 대상은 https URL이어야 합니다");
    const keyEnv = values["--key-env"];
    const keyParam = values["--key-param"];
    if (keyEnv === undefined || !(KEY_ENV_NAMES as readonly string[]).includes(keyEnv)) {
      return usage(`url: 대상에는 --key-env(${KEY_ENV_NAMES.join(", ")} 중 하나)가 필요합니다`);
    }
    if (keyParam === undefined) return usage("url: 대상에는 --key-param이 필요합니다");
    if (!noSave && outFileRaw === undefined) return usage("url: 대상은 --no-save 또는 --out-file이 필요합니다");
    req = { label: target, url: base.toString(), keyParam, keyEnv };
  } else if (target.startsWith("law:")) {
    const lawTarget = target.slice("law:".length);
    if (!(LAW_TARGETS as readonly string[]).includes(lawTarget)) return usage(`알 수 없는 법제처 target: ${lawTarget}`);
    const svc = bools.has("--service") || lawTarget === "lawjosub" ? "lawService.do" : "lawSearch.do";
    req = { label: target, url: `${LAW_BASE}${svc}`, keyParam: "OC", keyEnv: "LAW_OC", folder: join("test", "fixtures", "law", lawTarget) };
    needsFolder = true;
    params.push(["target", lawTarget]);
  } else {
    const specId = target;
    if (!Object.hasOwn(SPECS, specId) || specId === "vaccClinic") {
      return usage(`알 수 없는 target: ${specId}`);
    }
    const spec = SPECS[specId as keyof typeof SPECS];
    const base = values["--base"] ?? spec.baseUrl;
    const op = values["--op"] ?? spec.operation;
    if (base === "" || op === "") return usage(`${specId}: baseUrl 또는 operation이 비어 있습니다. --base와 --op를 지정하세요`);
    if (values["--base"] !== undefined) {
      const bu = isHttpsUrl(values["--base"]);
      if (!bu || !ALLOWED_BASE_HOSTS.includes(bu.hostname)) {
        return usage(`--base는 https이고 호스트가 ${ALLOWED_BASE_HOSTS.join(", ")} 중 하나여야 합니다`);
      }
    }
    req = {
      label: target,
      url: `${base}/${op}`,
      keyParam: "serviceKey",
      keyEnv: "DATA_GO_KR_SERVICE_KEY",
      folder: join("test", "fixtures", "data-go-kr", specId),
    };
    needsFolder = true;
  }

  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    return usage("요청 URL을 만들 수 없습니다");
  }
  if (url.protocol !== "https:") return usage("요청 URL은 https여야 합니다");

  let outFile: string | undefined;
  if (outFileRaw !== undefined) {
    if (!isAbsolute(outFileRaw) || !isOutsideRoot(root, outFileRaw)) {
      return usage("--out-file은 저장소(root) 밖의 절대 경로여야 합니다");
    }
    outFile = outFileRaw;
  }

  if (rawOutRaw !== undefined && (!isAbsolute(rawOutRaw) || !isOutsideRoot(root, rawOutRaw))) {
    return usage("--raw-out은 저장소(root) 밖의 절대 경로여야 합니다");
  }

  let notePath: string | undefined;
  if (noteRaw !== undefined) {
    const abs = resolve(root, noteRaw);
    const notesDir = resolve(root, ".docs", "api-notes");
    if (!isUnder(notesDir, abs) || !abs.endsWith(".md")) {
      return usage("--note는 .docs/api-notes/ 아래의 .md 파일이어야 합니다");
    }
    notePath = abs;
  }

  if (name === undefined && needsFolder && outFile === undefined && !noSave) {
    return usage("저장하려면 --name이 필요합니다");
  }

  const keyValue = badKey ? PLACEHOLDER_KEY : io.env[req.keyEnv];
  if (!badKey && (keyValue === undefined || keyValue.trim() === "")) {
    complain(`키 환경변수 ${req.keyEnv}이(가) 설정되지 않았습니다\n`);
    return EXIT.USAGE;
  }
  const key = keyValue ?? PLACEHOLDER_KEY;

  let saveDir: string | undefined;
  if (outFile === undefined && !noSave && req.folder !== undefined && name !== undefined) {
    saveDir = join(root, req.folder);
    const dir = saveDir;
    const existing = FIXTURE_EXTS.map((ext) => join(dir, `${name}.${ext}`)).filter((p) => existsSync(p));
    if (existing.length > 0 && !force) {
      complain(`이미 저장된 fixture가 있어 호출하지 않습니다(--force로 덮어쓰기): ${relative(root, existing[0] ?? "")}\n`);
      return EXIT.USAGE;
    }
  }
  if (outFile !== undefined && existsSync(outFile) && !force) {
    complain(`이미 존재하는 파일이어서 호출하지 않습니다(--force로 덮어쓰기): ${outFile}\n`);
    return EXIT.USAGE;
  }
  if (rawOutRaw !== undefined && existsSync(rawOutRaw) && !force) {
    complain(`이미 존재하는 파일이어서 호출하지 않습니다(--force로 덮어쓰기): ${rawOutRaw}\n`);
    return EXIT.USAGE;
  }

  url.searchParams.set(req.keyParam, key);
  for (const [n, v] of params) url.searchParams.set(n, v);
  if (req.label.startsWith("law:") && !url.searchParams.has("type")) url.searchParams.set("type", "JSON");

  const shown = new URL(url.toString());
  shown.searchParams.set(req.keyParam, MASK);
  const displayUrl = shown.toString().replace(`${req.keyParam}=%2A%2A%2A`, `${req.keyParam}=${MASK}`);

  let status: number | null = null;
  let contentType = "";
  let body = "";
  try {
    const res = await io.fetch(url.toString(), { signal: AbortSignal.timeout(timeoutMs) });
    status = res.status;
    contentType = res.headers.get("content-type") ?? "";
    body = await res.text();
  } catch {
    status = null;
    contentType = "";
    body = "";
  }

  const summary = summarize(body, status, contentType);
  const masked = mask(body, secrets);
  if (status !== null && rawOutRaw !== undefined) {
    const rawLeaks = findLeaks(masked, secrets);
    if (rawLeaks.length > 0) {
      complain(`저장 거부: 마스킹 누락(${rawLeaks.join(", ")})\n`);
      return EXIT.UNAVAILABLE;
    }
    mkdirSync(dirname(rawOutRaw), { recursive: true });
    writeFileSync(rawOutRaw, masked, "utf8");
  }
  const trimmed = trimItems(masked, summary.format, maxItems, itemsKey);

  let savedPath: string | undefined;
  if (status !== null && (outFile !== undefined || (!noSave && saveDir !== undefined))) {
    const finalPath = outFile ?? join(saveDir ?? root, `${name ?? ""}.${EXT_BY_FORMAT[summary.format]}`);
    const leaks = findLeaks(trimmed.text, secrets);
    if (leaks.length > 0) {
      complain(`저장 거부: 마스킹 누락(${leaks.join(", ")})\n`);
      return EXIT.UNAVAILABLE;
    }
    mkdirSync(dirname(finalPath), { recursive: true });
    writeFileSync(finalPath, trimmed.text, "utf8");
    savedPath = finalPath;
  }

  const lines = [
    `[record-sample] ${req.label}${name !== undefined ? ` ${name}` : ""}`,
    `요청: ${displayUrl}`,
    `HTTP: ${status ?? "없음(시간 초과·네트워크 오류)"}`,
    `content-type: ${contentType || "-"}`,
    `형식: ${summary.format}`,
    `바이트: ${summary.bytes}`,
    `코드: ${summary.code ?? "-"}`,
    `totalCount: ${summary.totalCount ?? "-"}`,
    `항목 수: ${trimmed.before < 0 ? "-" : `${trimmed.before}→${trimmed.after}`}`,
    `분류: ${summary.classification}`,
    `저장: ${savedPath !== undefined ? relative(root, savedPath) : "저장 안 함"}`,
    `원본 사본: ${rawOutRaw !== undefined && status !== null ? rawOutRaw : "없음"}`,
  ];
  const block = lines.join("\n") + "\n";
  say(block);

  if (notePath !== undefined) {
    const date = formatDate(todayKst({ now: io.now }));
    const heading = `### ${date} ${req.label}${name !== undefined ? ` ${name}` : ""}`;
    mkdirSync(dirname(notePath), { recursive: true });
    appendFileSync(notePath, maskSample(`\n${heading}\n\n${block}`, secrets), "utf8");
  }

  return status === null ? EXIT.UNAVAILABLE : EXIT.OK;
}

if (isMainModule(import.meta.url)) main(process.argv.slice(2), processIO()).then((c) => process.exit(c));
