// CI 전용(ADR-14). src/에서 import 금지.
import { createRequire } from "node:module";
import { dirname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { ANNEX_LIMITS } from "./annex-fetch.js";

interface PdfTextItem {
  str?: unknown;
  transform?: number[];
  hasEOL?: boolean;
}

interface PdfPage {
  getTextContent(): Promise<{ items: unknown[] }>;
}

interface PdfDoc {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
  destroy(): Promise<void>;
}

interface PdfTask {
  promise: Promise<PdfDoc>;
  destroy(): Promise<void>;
}

interface PdfjsLib {
  getDocument(src: Record<string, unknown>): PdfTask;
  GlobalWorkerOptions: { workerSrc: string };
}

interface PdfjsModule {
  lib: PdfjsLib;
  cmapUrl: string;
  fontUrl: string;
}

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/g;

export function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL_CHARS, "")
    .normalize("NFC")
    .split("\n")
    .map((line) => line.replace(/[ \t　]+/g, " ").trim())
    .filter((line) => line !== "")
    .join("\n");
}

let pdfjsCache: Promise<PdfjsModule> | undefined;

function loadPdfjs(): Promise<PdfjsModule> {
  pdfjsCache ??= (async () => {
    const req = createRequire(import.meta.url);
    const entry = req.resolve("pdfjs-dist/legacy/build/pdf.mjs");
    const root = resolve(dirname(entry), "../..");
    const lib = (await import(pathToFileURL(entry).href)) as PdfjsLib;
    if (!lib.GlobalWorkerOptions.workerSrc) {
      lib.GlobalWorkerOptions.workerSrc = pathToFileURL(join(dirname(entry), "pdf.worker.mjs")).href;
    }
    return { lib, cmapUrl: join(root, "cmaps") + sep, fontUrl: join(root, "standard_fonts") + sep };
  })();
  return pdfjsCache;
}

export async function extractPdfText(
  bytes: Uint8Array,
  opts?: { maxChars?: number; maxPages?: number },
): Promise<{ ok: true; text: string; truncated: boolean } | { ok: false; reason: "no_text" | "extract_failed" }> {
  const maxChars = opts?.maxChars ?? ANNEX_LIMITS.maxChars;
  const maxPages = opts?.maxPages ?? 300;
  let task: PdfTask | undefined;
  let doc: PdfDoc | undefined;
  try {
    const { lib, cmapUrl, fontUrl } = await loadPdfjs();
    task = lib.getDocument({
      data: new Uint8Array(bytes),
      cMapUrl: cmapUrl,
      cMapPacked: true,
      standardFontDataUrl: fontUrl,
      useSystemFonts: false,
      disableFontFace: true,
      isEvalSupported: false,
      verbosity: 0,
    });
    doc = await task.promise;
    const lines: string[] = [];
    const pageCount = Math.min(doc.numPages, maxPages);
    for (let n = 1; n <= pageCount; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      let cur = "";
      let lastY: number | undefined;
      for (const raw of content.items) {
        const item = raw as PdfTextItem;
        if (typeof item.str !== "string") continue;
        const y = item.transform?.[5];
        if (cur !== "" && lastY !== undefined && y !== undefined && Math.abs(y - lastY) > 1) {
          lines.push(cur);
          cur = "";
        }
        cur += item.str;
        if (item.hasEOL) {
          lines.push(cur);
          cur = "";
        }
        lastY = y;
      }
      if (cur !== "") lines.push(cur);
    }
    const text = normalizeText(lines.join("\n"));
    if (text === "") return { ok: false, reason: "no_text" };
    if (text.length > maxChars) {
      const cut = text.slice(0, maxChars);
      const at = cut.lastIndexOf("\n");
      return { ok: true, text: at > 0 ? cut.slice(0, at) : cut, truncated: true };
    }
    return { ok: true, text, truncated: false };
  } catch {
    return { ok: false, reason: "extract_failed" };
  } finally {
    await doc?.destroy().catch(() => undefined);
    await task?.destroy().catch(() => undefined);
  }
}
