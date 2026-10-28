/** R2: name·title·description·필드 설명 금지 표현("비공식"은 허용). */
export const OFFICIAL_CLAIM_META: readonly RegExp[] = [/(?<!비)공식/, /아이사랑/, /에서\s*제공하는/, /정부\s*(제공|공식)/, /예방접종도우미/, /건강\s*iN/i, /유치원알리미\s*(공식|제휴|연동)/];

/** R2: 출력 금지 표현(자기 지칭 공식 주장). "공식 서비스가 아닙니다", "공식 기관/포털", 링크 이름 "아이사랑"은 허용. */
export const OFFICIAL_CLAIM_OUTPUT: readonly RegExp[] = [
  /(?<!비)공식\s*(앱|도구|서버|MCP)/,
  /(?<!비)공식\s*서비스(?!가 아닙니다)/,
  /에서\s*제공하는\s*(조회\s*)?(서비스|도구)/,
  /아이사랑\s*(공식|제휴|연동)/,
  /아이사랑\s*(이|가|에서)?\s*제공/,
  /정부\s*(제공|공식)/,
  /(예방접종도우미|건강iN)\s*(공식|제휴|연동)/,
  /유치원알리미\s*(공식|제휴|연동)/,
];

export const ASSERTIVE_SAFETY = /안전합니다|안전한 제품|안전한 것으로|문제없|문제 없|구매해도|사용해도 됩니다|리콜 대상이 아닙니다/;

/** R3: 기관 존재·운영·재고·예약 가능 단정 표현. */
export const CLINIC_ASSERT = /재고가?\s*(있습니다|있어요|충분)|접종\s*가능합니다|예약\s*가능합니다|예약할 수 있습니다|검진\s*가능합니다|진료\s*중입니다|운영\s*중입니다|문을 열었습니다|접종받을 수 있습니다|검진받을 수 있습니다|지정\s*기관입니다/;

export const DAYCARE_ASSERT =/\d[\d,]*\s*(원|명)|정원은|순번은|대기\s*\d|입소\s*(가능합니다|됩니다)|비용은/;

/** M16 R12: 유치원 입학·여석 단정 표현. */
export const KINDERGARTEN_ASSERT = /입학\s*가능|입소\s*가능|자리\s*있(음|습니다|어요)|빈자리가\s*있|여석이\s*있(음|습니다|어요)|등록\s*가능|모집\s*중입니다|바로\s*입학|확실히/;

export function matchedPatterns(text: string, patterns: readonly RegExp[]): string[] {
  return patterns.filter((p) => p.test(text)).map((p) => p.source);
}
