import { MCPB_ASSET, MCPB_TAG } from "../../scripts/docs/links.js";

export const USES =
  /^(actions\/[a-z-]+(\/[a-z-]+)?@v\d+\.\d+\.\d+|docker:\/\/rhysd\/actionlint:\d+\.\d+\.\d+|[\w.-]+\/[\w.-]+@[0-9a-f]{40})$/;

export function steps(text: string): string[] {
  return text.split(/^ {6}- /m);
}

export function block(text: string, needle: string): string {
  return steps(text).find((s) => s.includes(needle)) ?? "";
}

export function blockIndex(text: string, needle: string): number {
  return steps(text).findIndex((s) => s.includes(needle));
}

export function secretNames(text: string): string[] {
  return [...text.matchAll(/\$\{\{\s*secrets\.([A-Za-z_]+)\s*\}\}/g)].map((m) => m[1] ?? "");
}

export function topPermissions(text: string): Record<string, string> {
  const lines = text.split("\n");
  const idx = lines.indexOf("permissions:");
  const out: Record<string, string> = {};
  if (idx < 0) return out;
  for (const line of lines.slice(idx + 1)) {
    const m = /^ {2}([\w-]+): (\S+)\s*$/.exec(line);
    if (!m) break;
    out[m[1] ?? ""] = m[2] ?? "";
  }
  return out;
}

export function stepIndex(text: string, re: RegExp): number {
  return steps(text).findIndex((s) => re.test(s));
}

export function mcpbReleaseProblems(text: string): string[] {
  const problems: string[] = [];
  const lines = text.split("\n");
  const onIdx = lines.indexOf("on:");
  const permIdx = lines.indexOf("permissions:");
  const triggers = onIdx >= 0 && permIdx > onIdx ? lines.slice(onIdx + 1, permIdx) : [];
  if (JSON.stringify(triggers) !== JSON.stringify(["  push:", "    branches: [main]", "  workflow_dispatch:"])) {
    problems.push("트리거가 push(main)과 workflow_dispatch로만 구성되어 있지 않습니다.");
  }

  if (JSON.stringify(topPermissions(text)) !== JSON.stringify({ contents: "write" })) {
    problems.push("최상위 permissions가 contents: write 하나여야 합니다.");
  }
  if ((text.match(/^[ \t]*permissions:/gm) ?? []).length !== 1) {
    problems.push("permissions 블록이 한 개여야 합니다.");
  }

  if (!/^concurrency:\n  group: mcpb-release\n  cancel-in-progress: false$/m.test(text)) {
    problems.push("concurrency(group: mcpb-release, cancel-in-progress: false)가 없습니다.");
  }

  if (!text.includes("    if: github.ref == 'refs/heads/main'")) {
    problems.push("작업에 main 브랜치 전용 if 조건이 없습니다.");
  }

  if (text.includes("continue-on-error")) problems.push("continue-on-error를 쓰면 안 됩니다.");
  if (/always\(\)|failure\(\)|cancelled\(\)|\|\|\s*true/.test(text)) {
    problems.push("always()/failure()/cancelled()/|| true 같은 실패 우회가 있습니다.");
  }
  if (text.includes("secrets.")) problems.push("secrets.를 쓰면 안 됩니다.");
  if (/upload-artifact|download-artifact/.test(text)) {
    problems.push("artifact 업로드/다운로드를 쓰면 안 됩니다.");
  }
  for (const m of text.matchAll(/uses:\s*(\S+)/g)) {
    if (!USES.test(m[1] ?? "")) problems.push(`고정되지 않은 uses 값입니다: ${m[1] ?? ""}`);
  }

  const npmCi = stepIndex(text, /^run: npm ci$/m);
  const verify = stepIndex(text, /^run: npm run verify$/m);
  const pack = stepIndex(text, /^\s*run: npm run pack:mcpb$/m);
  const smoke = stepIndex(text, /^\s*run: npm run smoke:mcpb$/m);
  const publish = stepIndex(text, /gh release upload/);
  const check = stepIndex(text, /mcpb-release-check\.js/);
  const order = [npmCi, verify, pack, smoke, publish, check];
  if (order.some((i) => i < 0)) {
    problems.push("필수 단계(npm ci, verify, pack, smoke, publish, check) 중 빠진 것이 있습니다.");
  } else {
    for (let i = 1; i < order.length; i++) {
      if (order[i - 1]! >= order[i]!) {
        problems.push("단계 순서가 npm ci → verify → pack → smoke → publish → check 이어야 합니다.");
        break;
      }
    }
  }
  if (check >= 0 && check !== steps(text).length - 1) {
    problems.push("다운로드 확인 단계가 마지막 단계여야 합니다.");
  }

  if (pack >= 0 && !steps(text)[pack]?.includes("KPM_BUILD_COMMIT: ${{ github.sha }}")) {
    problems.push("pack 단계에 KPM_BUILD_COMMIT: ${{ github.sha }}가 없습니다.");
  }
  if (smoke >= 0 && !steps(text)[smoke]?.includes("KPM_BUILD_COMMIT: ${{ github.sha }}")) {
    problems.push("smoke 단계에 KPM_BUILD_COMMIT: ${{ github.sha }}가 없습니다.");
  }

  if (publish >= 0) {
    const pub = steps(text)[publish] ?? "";
    if (/^\s*if:/m.test(pub)) problems.push("publish 단계에 if 조건이 있으면 안 됩니다.");
    const required = [
      "GH_TOKEN: ${{ github.token }}",
      `TAG: ${MCPB_TAG}`,
      `FILE: build-mcpb/${MCPB_ASSET}`,
      'git tag -f "$TAG" "$GITHUB_SHA"',
      'git push -f origin "refs/tags/$TAG"',
      'gh release upload "$TAG" "$FILE" --clobber',
      'gh release create "$TAG" "$FILE" --prerelease',
      'gh release edit "$TAG" --prerelease',
      "- 커밋: $GITHUB_SHA",
    ];
    for (const s of required) {
      if (!pub.includes(s)) problems.push(`publish 단계에 없는 내용: ${s}`);
    }
    const pushAt = pub.indexOf("git push -f");
    const uploadAt = pub.indexOf("gh release upload");
    if (pushAt < 0 || uploadAt < 0 || pushAt >= uploadAt) {
      problems.push("태그 push가 release upload보다 먼저 와야 합니다.");
    }
    if (/gh release delete|delete-asset/.test(pub)) {
      problems.push("publish 단계에서 release 삭제를 하면 안 됩니다.");
    }
  }

  if (check >= 0) {
    const chk = steps(text)[check] ?? "";
    for (const s of [
      "github.event.repository.private",
      "::warning",
      'mcpb-release-check.js --commit "$GITHUB_SHA"',
      "attempts=12",
      'exit "$code"',
    ]) {
      if (!chk.includes(s)) problems.push(`다운로드 확인 단계에 없는 내용: ${s}`);
    }
    for (const s of ["GH_TOKEN", "github.token", "--url"]) {
      if (chk.includes(s)) problems.push(`다운로드 확인 단계에 ${s}가 있으면 안 됩니다.`);
    }
  }

  return problems;
}
