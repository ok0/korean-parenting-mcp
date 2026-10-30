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
