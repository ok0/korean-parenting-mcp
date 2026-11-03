import { KEY_ENV, type KeyEnvName, type KeyName } from "./config.js";
import type { ToolContext } from "./context.js";
import { maskSecrets } from "./secrets.js";
import { DEFAULT_ACTIONS, ToolError, type ErrorKind } from "./tool-error.js";
export { DEFAULT_ACTIONS, ToolError, type ErrorKind } from "./tool-error.js";

export interface ToolResult {
  [k: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export const KEY_GUIDE: Record<
  KeyName,
  { env: KeyEnvName; title: string; steps: string[]; url: string; tools: string[] }
> = {
  DATA_GO_KR: {
    env: KEY_ENV.DATA_GO_KR,
    title: "공공데이터포털 일반 인증키(Decoding)",
    url: "https://www.data.go.kr",
    steps: [
      "공공데이터포털에 회원가입 후 로그인합니다.",
      "필요한 API마다 '활용신청'을 하고 승인을 기다립니다(승인 전 호출은 오류 코드 20).",
      "마이페이지 > 개발계정에서 일반 인증키(Decoding)를 복사해 그대로 설정합니다(Encoding 키를 넣으면 이중 인코딩으로 키 오류가 납니다).",
      "개발계정은 API별 일일 호출 한도(약 1,000~10,000회)가 있습니다. 부족하면 마이페이지에서 운영계정을 신청합니다.",
    ],
    tools: ["find_night_pediatric", "find_benefits", "check_pregnancy_drug", "find_local_support"],
  },
  KINDERGARTEN: {
    env: KEY_ENV.KINDERGARTEN,
    title: "유치원알리미 OpenAPI 인증키",
    url: "https://e-childschoolinfo.moe.go.kr",
    steps: [
      "유치원알리미 사이트(https://e-childschoolinfo.moe.go.kr)에 SNS 계정으로 로그인한 뒤 OpenAPI 메뉴에서 개발자 인증키를 신청합니다.",
      "인증키는 담당자 승인 후 발급되므로 승인까지 기다려야 할 수 있습니다.",
      "발급된 인증키를 KINDERGARTEN_API_KEY에 앞뒤 공백 없이 설정하고 MCP 클라이언트를 재시작합니다.",
    ],
    tools: ["find_kindergarten"],
  },
  LAW_OC: {
    env: KEY_ENV.LAW_OC,
    title: "국가법령정보 공동활용 OC",
    url: "https://open.law.go.kr",
    steps: [
      "국가법령정보 공동활용 사이트에 회원가입하고 OPEN API 사용을 신청합니다.",
      "OC 값(가입 이메일의 @ 앞부분)을 사용합니다.",
      "OPEN API 신청에서 사용할 API 종류(법령·행정규칙·별표서식)를 체크하고 호출하는 서버의 공인 IP 또는 도메인을 등록합니다(미등록이면 '사용자 정보 검증에 실패' 응답).",
    ],
    tools: ["get_leave_article"],
  },
  SAFETYKOREA: {
    env: KEY_ENV.SAFETYKOREA,
    title: "제품안전정보센터(SafetyKorea) Open API 서비스 ID",
    url: "https://www.safetykorea.kr",
    steps: [
      "SafetyKorea Open API 안내 페이지(https://www.safetykorea.kr/release/openapi)에서 사용신청서를 내려받아 작성한 뒤 safetykorea@korea.kr로 이메일 신청합니다.",
      "승인되면 서비스 ID가 이메일로 발급됩니다(승인 검토 후 발급까지 시간이 걸리며, 타인·타기관에 양도할 수 없습니다).",
      "발급된 서비스 ID를 SAFETYKOREA_AUTH_KEY에 설정합니다. 서버는 이 값을 HTTP 헤더 AuthKey로만 전송하고 URL에는 넣지 않습니다.",
      "MCP 클라이언트를 재시작합니다.",
    ],
    tools: ["check_recall"],
  },
};

export function missingKeyError(keys: KeyName[], extra?: readonly string[]): ToolError {
  const envs = keys.map((k) => KEY_GUIDE[k].env);
  const actions = [
    ...keys.map((k) => {
      const g = KEY_GUIDE[k];
      return `${g.env} — ${g.title}: ${g.steps.join(" ")} (발급: ${g.url})`;
    }),
    ...DEFAULT_ACTIONS.MISSING_KEY,
    ...(extra ?? []),
  ];
  return new ToolError("MISSING_KEY", `필요한 API 키가 설정되지 않았습니다: ${envs.join(", ")}`, {
    actions,
    detail: { keys: envs.join(",") },
  });
}

export const DATA_GO_KR_OK_CODES: ReadonlySet<string> = new Set(["00", "0", "INFO-000"]);

const DATA_GO_KR_CODES: Record<string, { kind: ErrorKind; summary: string }> = {
  "20": { kind: "NOT_APPROVED", summary: "서비스 접근 거부(활용신청 미승인 또는 미신청)" },
  "22": { kind: "DAILY_LIMIT", summary: "일일 호출 한도 초과" },
  "23": { kind: "RATE_LIMIT", summary: "초당 호출 한도 초과" },
  "30": { kind: "KEY_INVALID", summary: "등록되지 않은 서비스키" },
  "31": { kind: "KEY_EXPIRED", summary: "활용기간이 만료된 서비스키" },
  "-4": { kind: "KEY_INVALID", summary: "등록되지 않은 인증키(odcloud)" },
};

export function dataGoKrError(code: string): ToolError {
  const hit = Object.prototype.hasOwnProperty.call(DATA_GO_KR_CODES, code) ? DATA_GO_KR_CODES[code] : undefined;
  if (hit) {
    return new ToolError(hit.kind, `공공데이터포털 오류(코드 ${code}): ${hit.summary}`, { detail: { code } });
  }
  return new ToolError("UPSTREAM", `공공데이터포털 오류(코드 ${code})`, {
    detail: { code },
    actions: [`응답 코드 ${code}: 잠시 후 다시 시도하고, 계속되면 해당 API 안내 페이지의 오류 코드 표를 확인하세요.`],
  });
}

export const SAFETYKOREA_KEY_ACTIONS: string[] = [
  "SAFETYKOREA_AUTH_KEY에 SafetyKorea가 이메일로 발급한 서비스 ID를 앞뒤 공백 없이 그대로 설정했는지 확인하세요(서버가 HTTP 헤더 AuthKey로 전송합니다).",
  "서비스 ID가 승인·발급된 상태인지 확인하고, 문제가 계속되면 SafetyKorea(safetykorea@korea.kr)에 문의하세요.",
];
export const KINDERGARTEN_KEY_ACTIONS: string[] = [
  "KINDERGARTEN_API_KEY에 유치원알리미에서 발급받은 인증키를 앞뒤 공백 없이 그대로 설정했는지 확인하세요.",
  "인증키가 담당자 승인을 거쳐 발급된 상태인지 유치원알리미 사이트(https://e-childschoolinfo.moe.go.kr)에서 확인하고, 승인 대기 중이면 승인 후 다시 시도하세요.",
];
const SAFETYKOREA_ACCESS_ACTIONS: string[] = [
  "SafetyKorea(safetykorea@korea.kr)에 서비스 ID의 승인 상태와 발급 시 등록된 접속 정보(IP 등)를 확인해 달라고 요청하세요.",
  "결과코드 4001의 정확한 조건은 공개 문서에 설명되어 있지 않습니다.",
];
const SAFETYKOREA_CODES: Record<string, { kind: ErrorKind; summary: string; actions: string[] }> = {
  "4000": { kind: "KEY_INVALID", summary: "서비스 ID(인증키)가 유효하지 않음(Invalid Auth Key)", actions: SAFETYKOREA_KEY_ACTIONS },
  "4001": { kind: "NOT_APPROVED", summary: "접속 정보가 승인되지 않음(Invalid IP)", actions: SAFETYKOREA_ACCESS_ACTIONS },
  "4005": { kind: "UPSTREAM", summary: "요청 파라미터 오류(Invalid Parameter)", actions: ["검색어를 바꿔 다시 시도하세요. 계속되면 저장소 이슈로 알려주세요."] },
  "5000": { kind: "UPSTREAM", summary: "SafetyKorea 서버 내부 오류(Internal Server Error)", actions: ["SafetyKorea 서버 문제입니다. 잠시 후 다시 시도하세요."] },
};
export function safetyKoreaError(code: string): ToolError {
  const hit = Object.prototype.hasOwnProperty.call(SAFETYKOREA_CODES, code) ? SAFETYKOREA_CODES[code] : undefined;
  if (hit) return new ToolError(hit.kind, `SafetyKorea 오류(코드 ${code}): ${hit.summary}`, { actions: hit.actions, detail: { code } });
  return new ToolError("UPSTREAM", `SafetyKorea 오류(코드 ${code})`, {
    detail: { code },
    actions: [`응답 코드 ${code}: 잠시 후 다시 시도하고, 계속되면 저장소 이슈로 알려주세요.`],
  });
}

export function formatToolError(err: unknown, tool: string, ctx: Pick<ToolContext, "secrets" | "log">): ToolResult {
  const te =
    err instanceof ToolError
      ? err
      : new ToolError("INTERNAL", `내부 오류: ${err instanceof Error ? err.message : String(err)}`);
  const text = maskSecrets(
    `[${tool}] ${te.kind}: ${te.message}\n조치:\n` + te.actions.map((a) => `- ${a}`).join("\n"),
    ctx.secrets,
  );
  ctx.log.warn("tool error", { tool, kind: te.kind });
  return { content: [{ type: "text", text }], isError: true };
}
