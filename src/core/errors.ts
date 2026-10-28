import { KEY_ENV, type KeyEnvName, type KeyName } from "./config.js";
import type { ToolContext } from "./context.js";
import { maskSecrets } from "./secrets.js";

export type ErrorKind =
  | "BAD_INPUT"
  | "MISSING_KEY"
  | "NOT_APPROVED"
  | "KEY_INVALID"
  | "KEY_EXPIRED"
  | "DAILY_LIMIT"
  | "RATE_LIMIT"
  | "UPSTREAM"
  | "TIMEOUT"
  | "INTERNAL";

export interface ToolResult {
  [k: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export const DEFAULT_ACTIONS: Record<ErrorKind, string[]> = {
  BAD_INPUT: ["필드 설명의 형식과 예시를 확인해 입력을 고친 뒤 다시 호출하세요."],
  MISSING_KEY: ["MCP 클라이언트 설정의 env에 필요한 환경변수를 추가하고 클라이언트를 재시작하세요."],
  NOT_APPROVED: ["공공데이터포털 마이페이지에서 해당 API의 활용신청·승인 상태를 확인하세요."],
  KEY_INVALID: ["인증키를 다시 복사해 설정하세요(공공데이터포털은 Decoding 키 사용)."],
  KEY_EXPIRED: ["공공데이터포털에서 활용기간을 연장하세요."],
  DAILY_LIMIT: ["일일 호출 한도를 초과했습니다. 내일 다시 시도하거나 운영계정 전환을 신청하세요."],
  RATE_LIMIT: ["잠시 후 다시 시도하세요."],
  UPSTREAM: ["외부 기관 서버 응답에 문제가 있습니다. 잠시 후 다시 시도하세요."],
  TIMEOUT: ["응답 시간이 초과되었습니다. 범위를 줄이거나 잠시 후 다시 시도하세요."],
  INTERNAL: ["잠시 후 다시 시도하세요.", "문제가 계속되면 저장소 이슈로 알려주세요."],
};

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
    tools: [],
  },
  KINDERGARTEN: {
    env: KEY_ENV.KINDERGARTEN,
    title: "유치원알리미 OpenAPI 인증키",
    url: "https://e-childschoolinfo.moe.go.kr",
    steps: ["유치원알리미 사이트의 OpenAPI 메뉴에서 인증키를 신청합니다.", "발급된 인증키를 복사합니다."],
    tools: [],
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
};

export class ToolError extends Error {
  readonly kind: ErrorKind;
  readonly actions: string[];
  readonly detail?: Record<string, string>;

  constructor(kind: ErrorKind, message: string, opts?: { actions?: string[]; detail?: Record<string, string> }) {
    super(message);
    this.name = "ToolError";
    this.kind = kind;
    this.actions = opts?.actions ?? DEFAULT_ACTIONS[kind];
    this.detail = opts?.detail;
  }
}

export function missingKeyError(keys: KeyName[]): ToolError {
  const envs = keys.map((k) => KEY_GUIDE[k].env);
  const actions = [
    ...keys.map((k) => {
      const g = KEY_GUIDE[k];
      return `${g.env} — ${g.title}: ${g.steps.join(" ")} (발급: ${g.url})`;
    }),
    ...DEFAULT_ACTIONS.MISSING_KEY,
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
