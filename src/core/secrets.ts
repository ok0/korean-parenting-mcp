export function maskSecrets(text: string, secrets: readonly string[]): string {
  const variants = new Set<string>();
  for (const s of secrets) {
    if (s.length < 4) continue;
    variants.add(s);
    variants.add(encodeURIComponent(s));
    variants.add(new URLSearchParams({ k: s }).toString().slice(2));
  }
  const sorted = [...variants].sort((a, b) => b.length - a.length);
  let out = text;
  for (const v of sorted) out = out.split(v).join("***");
  return out;
}

export function maskKey(key: string): string {
  if (key.length < 4) return "***";
  return `${key.slice(0, 4)}…(${key.length}자)`;
}
