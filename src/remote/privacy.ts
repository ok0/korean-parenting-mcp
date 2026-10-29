import { DISCLAIMER_MEDICAL_LEGAL, NOTICE_UNOFFICIAL } from "../tools/shared/format.js";

export interface HostingDisclosure {
  provider: string;
  country: string;
  region: string;
  logRetention: string;
}

export const PRIVACY_POLICY_EFFECTIVE = "2026-10-29";

export type PrivacySectionId =
  | "purpose"
  | "items"
  | "retention"
  | "destruction"
  | "outsourcing"
  | "transfer"
  | "rights"
  | "contact"
  | "auto"
  | "changes";

export const PRIVACY_SECTIONS: readonly { id: PrivacySectionId; title: string }[] = [
  { id: "purpose", title: "1. 개인정보의 처리 목적" },
  { id: "items", title: "2. 처리하는 개인정보 항목" },
  { id: "retention", title: "3. 개인정보의 처리 및 보유 기간" },
  { id: "destruction", title: "4. 개인정보의 파기 절차 및 방법" },
  { id: "outsourcing", title: "5. 개인정보 처리업무의 위탁" },
  { id: "transfer", title: "6. 개인정보의 국외 이전" },
  { id: "rights", title: "7. 정보주체의 권리·의무 및 행사 방법" },
  { id: "contact", title: "8. 개인정보 보호 문의처" },
  { id: "auto", title: "9. 개인정보 자동 수집 장치의 설치·운영 및 거부" },
  { id: "changes", title: "10. 처리방침의 변경 이력 및 시행일" },
];

export const REMOTE_INPUT_NOTICE =
  "원격 서버 이용 중: 이름·연락처 등 식별정보를 입력하지 마세요. 건강 관련 입력이 신경 쓰이면 로컬 모드(npm·.mcpb)를 쓰세요.";

export const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function isKoreaCountry(country: string): boolean {
  return ["kr", "한국", "대한민국", "south korea"].includes(country.trim().toLowerCase());
}

function skeleton(title: string, body: string): string {
  const footer = `<footer><p>${escapeHtml(NOTICE_UNOFFICIAL)}</p><p>${escapeHtml(DISCLAIMER_MEDICAL_LEGAL)}</p></footer>`;
  return `<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${title}</title>\n<style>body{font-family:sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem;line-height:1.6}</style>\n</head>\n<body>${body}${footer}</body>\n</html>\n`;
}

function sectionBody(id: PrivacySectionId, opts: { contact: string; hosting: HostingDisclosure }): string {
  const { contact, hosting } = opts;
  const provider = escapeHtml(hosting.provider);
  const country = escapeHtml(hosting.country);
  const region = escapeHtml(hosting.region);
  const logRetention = escapeHtml(hosting.logRetention);
  switch (id) {
    case "purpose":
      return `<p>질의 응답 생성: 이용자가 입력한 질의에 대한 응답을 만드는 목적으로만 처리합니다.</p><p>그 외 목적으로 쓰지 않습니다.</p>`;
    case "items":
      return `<ul><li>도구 인자(질의 내용)는 응답을 만드는 동안 메모리에서만 처리하며 기록하지 않습니다.</li><li>접속 IP 주소는 요청 한도 계산을 위해 약 2분 동안 메모리에서만 사용하며 기록하거나 해시로 저장하지 않습니다.</li><li>호스팅 업체의 플랫폼 접근 로그(접속 IP 주소, 요청 시각 등)가 운영자와 별도로 생성될 수 있습니다.</li><li>서버 캐시는 공공 API 응답을 잠시 보관하는 휘발성 메모리이며 요청자와 연결되지 않습니다.</li><li>이름·연락처 등 식별정보와 건강 관련 정보는 입력하지 마세요. 건강 관련 입력이 신경 쓰이면 로컬 모드(npm·.mcpb)를 사용하세요.</li></ul>`;
    case "retention":
      return `<p>도구 인자와 접속 IP 주소는 응답 후 폐기합니다.</p><p>호스팅 업체 접근 로그 보존기간: ${logRetention}</p>`;
    case "destruction":
      return `<p>서버가 질의와 접속 정보를 저장하지 않으므로 별도 파기 대상이 없으며, 메모리의 값은 처리 후 사라집니다. 호스팅 접근 로그는 호스팅 업체의 보존기간이 지나면 삭제됩니다.</p>`;
    case "outsourcing":
      return `<ul><li>수탁자: ${provider}</li><li>위탁 업무: 서버 호스팅 및 접속 로그 처리</li><li>국가·리전: ${country} / ${region}</li><li>보유기간: ${logRetention}</li></ul>`;
    case "transfer":
      if (isKoreaCountry(hosting.country)) {
        return `<p>해당 없음: 서버가 대한민국에 있어 개인정보를 국외로 이전하지 않습니다.</p>`;
      }
      return `<p>개인정보가 국외로 이전됩니다(국외이전).</p><ul><li>이전받는 자: ${provider}</li><li>이전 국가: ${country}</li><li>리전: ${region}</li><li>이전 항목: 접속 정보(IP 주소, 요청 시각 등 접근 로그)</li><li>이전 목적: 서버 호스팅·운영</li><li>이전 시기·방법: 서비스 이용 시 네트워크로 전송</li><li>보유기간: ${logRetention}</li></ul>`;
    case "rights":
      return `<p>이용자는 개인정보의 열람·정정·삭제·처리정지를 요구할 수 있습니다.</p><p>서버가 질의를 저장하지 않으므로 개별 질의의 열람·삭제는 할 수 없습니다.</p><p>호스팅 접근 로그 관련 요청은 아래 문의처로 하면 운영자가 호스팅 업체 보존기간 안에서 확인·삭제를 요청합니다.</p>`;
    case "contact":
      return `<p>개인정보 보호책임자를 대신하는 운영자 연락처: ${escapeHtml(contact)}</p><p>요청 방법: 위 연락처로 요청 내용을 전달하세요.</p>`;
    case "auto":
      return `<p>쿠키, 스크립트, 추적 도구를 사용하지 않습니다.</p><p>거부 방법: 원격 서버 대신 로컬 모드(npm·.mcpb)를 사용하세요.</p>`;
    case "changes":
      return `<ul><li>${PRIVACY_POLICY_EFFECTIVE}: 최초 시행</li></ul><p>시행일: ${PRIVACY_POLICY_EFFECTIVE}</p>`;
  }
}

export function renderPrivacyPage(opts: { contact: string; host: string; hosting: HostingDisclosure }): string {
  const header = `<h1>korean-parenting-mcp 원격 서버 개인정보 처리방침</h1><p>이 개인정보 처리방침은 ${escapeHtml(opts.host)} 원격 서버에 적용됩니다.</p><p><a href="/">처음으로</a></p>`;
  const sections = PRIVACY_SECTIONS.map(
    (s) => `<section id="${s.id}"><h2>${s.title}</h2>${sectionBody(s.id, { contact: opts.contact, hosting: opts.hosting })}</section>`,
  ).join("");
  return skeleton("korean-parenting-mcp 원격 서버 개인정보 처리방침", header + sections);
}

export function renderLandingPage(opts: { host: string }): string {
  const body = `<h1>korean-parenting-mcp 원격 서버</h1><p>한국 임신·출산·육아 일정과 공공 정보를 안내하는 비공식 MCP 서버의 원격 접속 주소입니다.</p><p>커넥터 URL: <code>https://${escapeHtml(opts.host)}/mcp</code></p><p><a href="/privacy">개인정보 처리방침</a></p><p>${escapeHtml(REMOTE_INPUT_NOTICE)}</p><p>건강 정보 입력이 신경 쓰이면 npm 패키지나 .mcpb 번들로 설치하는 로컬 모드를 사용하세요.</p>`;
  return skeleton("korean-parenting-mcp 원격 서버", body);
}
