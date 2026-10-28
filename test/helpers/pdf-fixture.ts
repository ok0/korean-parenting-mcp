const CHAR_LIMIT = 200;
const WIDTH_FIRST_CODE = 0x21;

function hex2(n: number): string {
  return n.toString(16).toUpperCase().padStart(2, "0");
}

function hex4(n: number): string {
  return n.toString(16).toUpperCase().padStart(4, "0");
}

function toUnicodeBody(table: readonly string[]): string {
  const parts = [
    "/CIDInit /ProcSet findresource begin",
    "12 dict begin",
    "begincmap",
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
    "/CMapName /Adobe-Identity-UCS def",
    "/CMapType 2 def",
    "1 begincodespacerange",
    "<00> <FF>",
    "endcodespacerange",
  ];
  for (let start = 0; start < table.length; start += 100) {
    const block = table.slice(start, start + 100);
    parts.push(`${block.length} beginbfchar`);
    block.forEach((ch, j) => {
      const code = WIDTH_FIRST_CODE + start + j;
      parts.push(`<${hex2(code)}> <${hex4(ch.codePointAt(0) ?? 0)}>`);
    });
    parts.push("endbfchar");
  }
  parts.push("endcmap", "CMapName currentdict /CMap defineresource pop", "end", "end");
  return parts.join("\n");
}

function stream(data: string): string {
  return `<< /Length ${data.length} >>\nstream\n${data}\nendstream`;
}

export function makeTextPdf(lines: readonly string[], opts?: { linesPerPage?: number }): Uint8Array {
  const table = [...new Set([" ", ...lines.join("")])];
  if (table.length > CHAR_LIMIT) throw new Error("too many distinct characters for fixture");
  for (const ch of table) {
    if ((ch.codePointAt(0) ?? 0) > 0xffff) throw new Error("fixture supports BMP characters only");
  }
  const codeOf = new Map(table.map((ch, i) => [ch, WIDTH_FIRST_CODE + i]));
  const perPage = opts?.linesPerPage ?? 40;
  const pages: string[][] = [];
  for (let start = 0; start < lines.length; start += perPage) {
    pages.push(lines.slice(start, start + perPage));
  }
  if (pages.length === 0) pages.push([]);

  const pageContents = pages.map((pageLines) =>
    pageLines
      .map((line, i) => {
        const hex = [...line].map((ch) => hex2(codeOf.get(ch) ?? 0)).join("");
        return `BT /F1 12 Tf 50 ${750 - i * 18} Td <${hex}> Tj ET`;
      })
      .join("\n"),
  );

  const n = pages.length;
  const kids = pages.map((_, k) => `${5 + 2 * k} 0 R`).join(" ");
  const widths = Array(table.length).fill("600").join(" ");
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${kids}] /Count ${n} >>`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /FirstChar 33 /LastChar ${32 + table.length} /Widths [${widths}] /ToUnicode 4 0 R >>`,
    stream(toUnicodeBody(table)),
  ];
  pageContents.forEach((content, k) => {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${6 + 2 * k} 0 R >>`,
    );
    objects.push(stream(content));
  });

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, idx) => {
    offsets.push(pdf.length);
    pdf += `${idx + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  const count = objects.length;
  pdf += `xref\n0 ${count + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${count + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf, "latin1"));
}

export const HWP_BYTES: Uint8Array = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, ...Array(504).fill(0)]);

export const PNG_BYTES: Uint8Array = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array(24).fill(0)]);

export function binRes(
  bytes: Uint8Array,
  opts?: { status?: number; contentType?: string; withLength?: boolean },
): Response {
  const headers: Record<string, string> = { "content-type": opts?.contentType ?? "application/pdf" };
  if (opts?.withLength === true) headers["content-length"] = String(bytes.byteLength);
  return new Response(bytes, { status: opts?.status ?? 200, headers });
}

export function chunkedRes(totalBytes: number, chunkBytes: number): Response {
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= totalBytes) {
        controller.close();
        return;
      }
      const size = Math.min(chunkBytes, totalBytes - sent);
      controller.enqueue(new Uint8Array(size).fill(0x25));
      sent += size;
    },
  });
  return new Response(stream, { headers: { "content-type": "application/pdf" } });
}

export function hangingFetchRes(init?: RequestInit): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  });
}
