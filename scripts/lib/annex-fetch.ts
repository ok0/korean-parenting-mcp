export interface AnnexLimits {
  maxBytes: number;
  timeoutMs: number;
  maxChars: number;
}

export const ANNEX_LIMITS: AnnexLimits = { maxBytes: 10_485_760, timeoutMs: 20_000, maxChars: 400_000 };

export type AnnexFailReason =
  | "no_url"
  | "hwp"
  | "no_text"
  | "blocked"
  | "download_failed"
  | "timeout"
  | "too_large"
  | "unsupported"
  | "extract_failed";

export const ANNEX_REASON_TEXT: Record<AnnexFailReason, string> = {
  no_url: "첨부 URL 없음(응답에 첨부 링크가 없음)",
  hwp: "HWP/HWPX 형식(텍스트 추출 미지원)",
  no_text: "텍스트 없음(이미지 전용 PDF 등)",
  blocked: "다운로드 차단(HTTP 401·403, 오류 페이지 또는 법제처 외 주소)",
  download_failed: "다운로드 실패(HTTP 오류·네트워크 오류)",
  timeout: "다운로드 시간 초과",
  too_large: "크기 초과(다운로드 상한 초과)",
  unsupported: "지원하지 않는 형식(이미지 등)",
  extract_failed: "PDF 해석 실패",
};

export type FileFormat = "pdf" | "hwp" | "html" | "image" | "unknown";

const LAW_BASE = "https://www.law.go.kr";

export function isLawHost(hostname: string): boolean {
  return hostname === "law.go.kr" || hostname.endsWith(".law.go.kr");
}

export function safeAttachmentUrl(raw: string | undefined): URL | undefined {
  if (raw === undefined || raw === "") return undefined;
  let url: URL;
  try {
    url = new URL(raw, LAW_BASE);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  if (!isLawHost(url.hostname)) return undefined;
  const kept = [...url.searchParams.entries()].filter(([k]) => k.toLowerCase() !== "oc");
  url.search = kept.length > 0 ? new URLSearchParams(kept).toString() : "";
  url.protocol = "https:";
  return url;
}

function startsWithBytes(head: Uint8Array, sig: readonly number[]): boolean {
  return sig.every((b, i) => head[i] === b);
}

export function sniffFormat(bytes: Uint8Array, contentType: string): FileFormat {
  const head = bytes.subarray(0, 8);
  if (startsWithBytes(head, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf";
  if (
    startsWithBytes(head, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) ||
    startsWithBytes(head, [0x50, 0x4b, 0x03, 0x04])
  ) {
    return "hwp";
  }
  if (
    startsWithBytes(head, [0x89, 0x50, 0x4e, 0x47]) ||
    startsWithBytes(head, [0xff, 0xd8, 0xff]) ||
    startsWithBytes(head, [0x47, 0x49, 0x46, 0x38])
  ) {
    return "image";
  }
  const leading = new TextDecoder("utf-8").decode(bytes.subarray(0, 256)).trimStart();
  if (leading.startsWith("<") || /text\/html/i.test(contentType)) return "html";
  return "unknown";
}

export async function downloadAttachment(
  url: URL,
  fetchFn: typeof fetch,
  limits: Pick<AnnexLimits, "maxBytes" | "timeoutMs">,
): Promise<
  | { ok: true; bytes: Uint8Array; contentType: string }
  | { ok: false; reason: Extract<AnnexFailReason, "blocked" | "download_failed" | "timeout" | "too_large"> }
> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limits.timeoutMs);
  try {
    let res: Response;
    try {
      res = await fetchFn(url.href, { signal: controller.signal, redirect: "follow" });
    } catch {
      return { ok: false, reason: controller.signal.aborted ? "timeout" : "download_failed" };
    }
    if (res.url !== "") {
      let finalHost: string | undefined;
      try {
        finalHost = new URL(res.url).hostname;
      } catch {
        finalHost = undefined;
      }
      if (finalHost === undefined || !isLawHost(finalHost)) {
        await res.body?.cancel().catch(() => undefined);
        return { ok: false, reason: "blocked" };
      }
    }
    if (res.status === 401 || res.status === 403) {
      await res.body?.cancel().catch(() => undefined);
      return { ok: false, reason: "blocked" };
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      return { ok: false, reason: "download_failed" };
    }
    const declared = res.headers.get("content-length");
    if (declared !== null && Number(declared) > limits.maxBytes) {
      await res.body?.cancel().catch(() => undefined);
      return { ok: false, reason: "too_large" };
    }
    const contentType = res.headers.get("content-type") ?? "";
    try {
      if (res.body === null) {
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.byteLength > limits.maxBytes) return { ok: false, reason: "too_large" };
        return { ok: true, bytes, contentType };
      }
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > limits.maxBytes) {
          await reader.cancel().catch(() => undefined);
          return { ok: false, reason: "too_large" };
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return { ok: true, bytes, contentType };
    } catch {
      return { ok: false, reason: controller.signal.aborted ? "timeout" : "download_failed" };
    }
  } finally {
    clearTimeout(timer);
  }
}
