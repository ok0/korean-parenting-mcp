export const REPO = "ok0/korean-parenting-mcp";
export const RAW_ASSET_PREFIX = "https://raw.githubusercontent.com/ok0/korean-parenting-mcp/main/assets/";
export const LOCAL_ASSET_PREFIX = "../../assets/";

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
