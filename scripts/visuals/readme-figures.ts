export const REPO = "ok0/korean-parenting-mcp";
export const BRANCH = "main";
export const RAW_ASSET_PREFIX = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/assets/`;
export const LOCAL_ASSET_PREFIX = "../../assets/";
export const REPORT_FIGURE_ALT = "한 AI 앱에 실제로 보낸 출산 준비 질문과, 그 앱이 일정 계산과 지원금·휴일 소아 진료·유치원 정보를 찾아 준 실제 답변을 그림에 맞게 한 장으로 줄인 보고서입니다.";

export interface FigurePair {
  readonly name: string;
  readonly light: string;
  readonly dark: string;
}

export function assetPairs(files: readonly string[]): FigurePair[] {
  const pairs: FigurePair[] = [];
  for (const f of files) {
    const light = /^(.+)-light\.svg$/.exec(f);
    if (light) {
      const name = light[1] ?? "";
      const dark = `${name}-dark.svg`;
      if (!files.includes(dark)) throw new Error(`라이트/다크 짝이 없는 그림: ${f}`);
      pairs.push({ name, light: f, dark });
      continue;
    }
    const dark = /^(.+)-dark\.svg$/.exec(f);
    if (dark) {
      const name = dark[1] ?? "";
      if (!files.includes(`${name}-light.svg`)) throw new Error(`라이트/다크 짝이 없는 그림: ${f}`);
      continue;
    }
    throw new Error(`라이트/다크 짝이 없는 그림: ${f}`);
  }
  return pairs;
}
