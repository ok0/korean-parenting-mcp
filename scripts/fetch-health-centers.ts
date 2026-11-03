// 키는 DATA_GO_KR_SERVICE_KEY 환경변수로만 받는다(키 래퍼 with-keys.sh가 주입). 원본 페이지는 .docs/data-src/ 아래 또는 저장소 밖에만 저장하고, 저장한 파일은 빌드에 포함하지 않는다(R37, ADR-63).
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  API_ENDPOINT,
  ApiPageError,
  type ApiPage,
  MANIFEST_FILE,
  PAGE_FILE_RE,
  pageFileName,
  parseApiPage,
} from "./lib/health-centers-api.js";
import { createScriptContext, EXIT, isMainModule, parseFlags, processIO, type ScriptContext, type ScriptIO } from "./lib/script-io.js";

const USAGE =
  "사용법: node build-scripts/scripts/fetch-health-centers.js --out-dir <절대 경로> --max-calls <1~50> [--num-of-rows <1~1000, 기본 1000>] [--timeout-ms <n, 기본 20000>] [--force]";

const VALUE_FLAGS = ["--out-dir", "--max-calls", "--num-of-rows", "--timeout-ms"];

function ranged(raw: string | undefined, fallback: number | undefined, min: number, max: number): number | undefined {
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) return undefined;
  const n = Number(raw);
  return n >= min && n <= max ? n : undefined;
}

function isInside(dir: string, p: string): boolean {
  const rel = relative(dir, p);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

export async function main(argv: readonly string[], io: ScriptIO, deps?: { root?: string }): Promise<number> {
  let masker: ScriptContext | undefined;
  try {
    const force = argv.includes("--force");
    const parsed = parseFlags(
      argv.filter((arg) => arg !== "--force"),
      VALUE_FLAGS,
    );
    if ("error" in parsed) {
      io.stderr(`${USAGE}\n${parsed.error}\n`);
      return EXIT.USAGE;
    }
    const flags = parsed.flags;

    const maxCalls = ranged(flags["--max-calls"], undefined, 1, 50);
    if (maxCalls === undefined) {
      io.stderr(`${USAGE}\n--max-calls 값을 확인하세요\n`);
      return EXIT.USAGE;
    }
    const numOfRows = ranged(flags["--num-of-rows"], 1000, 1, 1000);
    if (numOfRows === undefined) {
      io.stderr(`${USAGE}\n--num-of-rows 값을 확인하세요\n`);
      return EXIT.USAGE;
    }
    const timeoutMs = ranged(flags["--timeout-ms"], 20000, 1000, 120000);
    if (timeoutMs === undefined) {
      io.stderr(`${USAGE}\n--timeout-ms 값을 확인하세요\n`);
      return EXIT.USAGE;
    }

    const outDir = flags["--out-dir"];
    if (outDir === undefined || !isAbsolute(outDir)) {
      io.stderr("--out-dir은 절대 경로여야 해요\n");
      return EXIT.USAGE;
    }
    const root = resolve(deps?.root ?? process.cwd());
    const dir = resolve(outDir);
    const outsideRepo = isOutside(root, dir);
    if (!outsideRepo && !isInside(join(root, ".docs", "data-src"), dir)) {
      io.stderr(`--out-dir은 저장소 밖이거나 .docs/data-src/ 아래여야 해요: ${dir}\n`);
      return EXIT.USAGE;
    }

    if (existsSync(dir)) {
      const names = readdirSync(dir).filter((f) => PAGE_FILE_RE.test(f) || f === MANIFEST_FILE);
      if (names.length > 0) {
        if (!force) {
          io.stderr(`이미 받은 파일이 있어요: ${dir} (--force로 다시 받기)\n`);
          return EXIT.USAGE;
        }
        for (const name of names) rmSync(join(dir, name));
      }
    }
    mkdirSync(dir, { recursive: true });

    const sc = createScriptContext(io);
    masker = sc;
    const key = sc.ctx.config.keys.DATA_GO_KR;
    if (key === undefined) {
      sc.err("DATA_GO_KR_SERVICE_KEY 환경변수가 설정되어 있어야 해요. 키 래퍼(with-keys.sh)로 실행하세요\n");
      return EXIT.UNAVAILABLE;
    }

    let calls = 0;
    let page = 1;
    let total: number | undefined;
    let collected = 0;
    let pagesWritten = 0;
    let complete = false;

    const writeManifest = (done: boolean): void => {
      const manifest = {
        dataset_id: "15107750",
        endpoint: API_ENDPOINT,
        fetched_at: io.now().toISOString(),
        num_of_rows: numOfRows,
        total_count: total ?? 0,
        pages: pagesWritten,
        items: collected,
        complete: done,
      };
      writeFileSync(join(dir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
    };
    const fail = (): void => writeManifest(false);

    for (;;) {
      if (calls >= maxCalls) break;

      const url = new URL(API_ENDPOINT);
      url.searchParams.set("serviceKey", key);
      url.searchParams.set("pageNo", String(page));
      url.searchParams.set("numOfRows", String(numOfRows));
      url.searchParams.set("type", "json");
      calls++;

      let res: Response;
      try {
        res = await io.fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        sc.err(`${page}쪽을 요청하지 못했어요 (${message})\n`);
        fail();
        return EXIT.UNAVAILABLE;
      }

      const text = await res.text();
      writeFileSync(join(dir, pageFileName(page)), sc.mask(text));
      pagesWritten++;

      if (!res.ok) {
        sc.err(`${page}쪽 HTTP ${res.status}\n`);
        fail();
        return EXIT.UNAVAILABLE;
      }

      let p: ApiPage;
      try {
        p = parseApiPage(text);
      } catch (e) {
        if (e instanceof ApiPageError) {
          sc.err(`${page}쪽: ${e.message}\n`);
          fail();
          return EXIT.UNAVAILABLE;
        }
        throw e;
      }

      if (page === 1) {
        total = p.totalCount;
        if (p.items.length < Math.min(numOfRows, total)) {
          sc.err(`한 쪽에 ${p.items.length}건만 왔어요(요청 ${numOfRows}건). --num-of-rows ${p.items.length}로 다시 실행하세요\n`);
          fail();
          return EXIT.UNAVAILABLE;
        }
        const needed = Math.max(1, Math.ceil(total / numOfRows));
        if (needed > maxCalls) {
          sc.err(`총 ${total}건을 받으려면 ${needed}회가 필요해요(--max-calls ${maxCalls}). --max-calls를 늘려 다시 실행하세요\n`);
          fail();
          return EXIT.UNAVAILABLE;
        }
      }

      collected += p.items.length;
      if (collected >= (total ?? 0) || p.items.length === 0) {
        complete = collected === total;
        break;
      }
      page++;
    }

    writeManifest(complete);
    sc.out(
      `총 건수: ${total ?? 0}\n받은 항목: ${collected}\n호출: ${calls}회 (예산 ${maxCalls}회)\n저장 위치: ${dir}\n`,
    );
    if (complete) return EXIT.OK;
    sc.err("받은 항목 수가 총 건수와 달라요\n");
    return EXIT.UNAVAILABLE;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    io.stderr(`확인 불가: 내부 오류 (${masker?.mask(message) ?? message})\n`);
    return EXIT.UNAVAILABLE;
  }
}

function isOutside(root: string, p: string): boolean {
  const rel = relative(root, p);
  return rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
}

if (isMainModule(import.meta.url)) void main(process.argv.slice(2), processIO()).then((c) => { process.exitCode = c; });
