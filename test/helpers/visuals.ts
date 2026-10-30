export const PLAIN_FORBIDDEN: readonly RegExp[] = [
  /API/i,
  /MCP/i,
  /JSON/i,
  /STDIO/i,
  /엔드포인트/,
  /서버/,
  /캐시/,
  /파이프라인/,
  /레지스트리/,
  /토큰/,
  /스키마/,
  /npm/i,
  /환경\s*변수/,
  /도구\s*ID/i,
  /인증키/,
  /\bSDK\b/i,
  /\bCLI\b/i,
  /HTTP/i,
];

export const SNAKE_ID = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/;

export const DEPLOY_TERMS: readonly RegExp[] = [
  /Cloud\s*Run/i,
  /run\.app/i,
  /원격/,
  /호스팅/,
  /Docker/i,
  /배포/,
  /커넥터/,
  /URL/i,
  /gcloud/i,
];

export const CLIENT_BRANDS: readonly RegExp[] = [
  /Claude/i,
  /클로드/,
  /Anthropic/i,
  /앤트로픽/,
  /ChatGPT/i,
  /챗\s*GPT/i,
  /챗지피티/,
  /\bGPT/i,
  /OpenAI/i,
  /오픈AI/i,
  /Cursor/i,
  /Antigravity/i,
  /Gemini/i,
  /제미나이/,
  /Copilot/i,
  /코파일럿/,
  /Perplexity/i,
  /Windsurf/i,
];

/** README 설치 안내 구획의 시작 제목(소개부 경계, R5·ADR-43 단일 기준). */
export const INSTALL_HEADING = "## 설치와 실행";

export function readmeIntro(readme: string): string {
  const i = readme.indexOf(INSTALL_HEADING);
  if (i < 0) throw new Error(`README에 ${INSTALL_HEADING} 제목이 없습니다`);
  return readme.slice(0, i);
}

export const ANSWER_FORBIDDEN: readonly RegExp[] = [
  /진단/,
  /처방/,
  /복용/,
  /투약/,
  /해열제/,
  /\d+\s*(mg|ml|㎎|㎖)/i,
  /먹이|드시|드세/,
  /국립중앙의료원|제품안전정보센터|질병관리청|보건복지부|식약처|식품의약품안전처|보건소/,
  /[가-힣]+(병원|의원|소아과|약국)/,
];

export function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function visibleText(svg: string): string {
  const noDesc = svg.replace(/<desc\b[^>]*>[\s\S]*?<\/desc>/g, "");
  const parts: string[] = [];
  for (const m of noDesc.matchAll(/<(title|tspan)\b[^>]*>([\s\S]*?)<\/\1>/g)) {
    parts.push(unescapeXml(m[2] ?? ""));
  }
  return parts.join("\n");
}

export interface TextEl {
  maxW: number;
  fontSize: number;
  bold: boolean;
  lines: string[];
}

export function textElements(svg: string): TextEl[] {
  const out: TextEl[] = [];
  for (const m of svg.matchAll(/<text([^>]*)>([\s\S]*?)<\/text>/g)) {
    const attrs = m[1] ?? "";
    const inner = m[2] ?? "";
    const attr = (name: string): string | undefined => {
      const a = new RegExp(`\\s${name}="([^"]*)"`).exec(attrs);
      return a?.[1];
    };
    const maxRaw = attr("data-max-w");
    const weight = attr("font-weight");
    const lines = [...inner.matchAll(/<tspan\b[^>]*>([\s\S]*?)<\/tspan>/g)].map((t) => unescapeXml(t[1] ?? ""));
    out.push({
      maxW: maxRaw === undefined ? NaN : Number(maxRaw),
      fontSize: Number(attr("font-size")),
      bold: weight === "bold" || Number(weight) >= 600,
      lines,
    });
  }
  return out;
}

function channel(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const h = hex.replace(/^#/, "");
  const full = h.length === 3 ? [...h].map((ch) => ch + ch).join("") : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

export function isoDates(s: string): string[] {
  return s.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
}

/** R8(M30b): 모든 그림 가시 글. '건강진단'은 도구 항목 제목이라 허용 */
export const FIGURE_MEDICAL_FORBIDDEN: readonly RegExp[] = [
  /(?<!건강)진단/,
  /처방/,
  /복용/,
  /투약/,
  /해열제/,
  /\d+\s*(mg|ml|㎎|㎖)/i,
  /먹이|드시|드세/,
];

export function flatText(svg: string): string {
  return textElements(svg).map((e) => e.lines.join(" ")).join("\n");
}

export function descText(svg: string): string {
  const m = /<desc id="desc">([\s\S]*?)<\/desc>/.exec(svg);
  return m ? unescapeXml(m[1] ?? "") : "";
}

export function htmlText(html: string): string {
  const stripped = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/gi, "");
  return unescapeXml(stripped.replace(/<[^>]*>/g, " "));
}
