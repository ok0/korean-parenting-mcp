import { MCPB_ASSET, MCPB_TAG } from "../../scripts/docs/links.js";
import { SOURCE_NOTICE } from "../../src/core/notice.js";

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
      `echo "${SOURCE_NOTICE}"`,
    ];
    for (const s of required) {
      if (!pub.includes(s)) problems.push(`publish 단계에 없는 내용: ${s}`);
    }
    if (/비공식|unofficial|관계없는|개인 프로젝트/i.test(pub)) problems.push("릴리스 본문에 부정형 소속 고지가 있습니다.");
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

export function runScript(text: string, name: string): string {
  const step = steps(text).find((s) => s.startsWith(`name: ${name}\n`)) ?? "";
  const lines = step.split("\n");
  const start = lines.indexOf("        run: |");
  if (start < 0) return "";
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line !== "" && !line.startsWith("          ")) break;
    body.push(line.slice(10));
  }
  return `${body.join("\n").trimEnd()}\n`;
}

export function npmPublishProblems(text: string): string[] {
  const problems: string[] = [];
  if (!/^on:\n {2}push:\n {4}tags: \["v\*"\]\npermissions:\n/m.test(text)) problems.push("트리거는 v* 태그 push 하나여야 합니다.");
  if (/workflow_dispatch|schedule:|pull_request|branches:/.test(text)) problems.push("태그 push 외 트리거가 있습니다.");
  if (JSON.stringify(topPermissions(text)) !== JSON.stringify({ contents: "read", "id-token": "write" })) problems.push("권한은 contents: read, id-token: write 두 개여야 합니다.");
  if (secretNames(text).length > 0 || /NODE_AUTH_TOKEN|NPM_TOKEN|secrets\./.test(text)) problems.push("토큰·시크릿 참조가 있습니다.");
  if (!/^concurrency:\n {2}group: npm-publish\n {2}cancel-in-progress: false\n/m.test(text)) problems.push("concurrency(cancel-in-progress: false)가 필요합니다.");
  if (!/^ {4}timeout-minutes: \d+$/m.test(text)) problems.push("timeout-minutes가 필요합니다.");
  const setup = block(text, "actions/setup-node@");
  if (!setup.includes('node-version: "22"') || !setup.includes('registry-url: "https://registry.npmjs.org"')) problems.push("setup-node는 Node 22와 npmjs registry-url을 써야 합니다.");
  const pin = /^ {8}run: npm install -g npm@(\d+)\.(\d+)\.(\d+)$/m.exec(text);
  const major = Number(pin?.[1] ?? 0);
  const minor = Number(pin?.[2] ?? 0);
  if (!pin || major < 11 || (major === 11 && minor < 15)) problems.push("npm은 11.15.0 이상 정확한 버전으로 설치해야 합니다.");
  const ciIdx = stepIndex(text, /^run: npm ci\s*$/m);
  const verifyIdx = stepIndex(text, /^run: npm run verify\s*$/m);
  const gateIdx = stepIndex(text, /npm --version/);
  const publishIdx = stepIndex(text, /^ {8}run: npm stage publish\s*$/m);
  const tagIdx = stepIndex(text, /GITHUB_REF_NAME/);
  const viewIdx = stepIndex(text, /npm view /);
  const summaryIdx = stepIndex(text, /GITHUB_STEP_SUMMARY/);
  const all = steps(text);
  if (publishIdx < 0) problems.push("게시 명령은 npm stage publish여야 합니다.");
  if (/--provenance/.test(text)) problems.push("--provenance 플래그는 쓰지 않습니다.");
  if (/\bnpm publish\b/.test(text)) problems.push("npm publish 대신 npm stage publish를 씁니다.");
  if (!(ciIdx >= 0 && ciIdx < verifyIdx && verifyIdx < gateIdx && gateIdx === publishIdx - 1)) problems.push("단계 순서는 npm ci → npm run verify → npm 버전 확인 → npm stage publish여야 합니다.");
  const gate = all[gateIdx] ?? "";
  if (!gate.includes("-lt 15") || !gate.includes("exit 1")) problems.push("npm 버전 확인 단계는 11.15 미만에서 실패해야 합니다.");
  const tag = all[tagIdx] ?? "";
  if (tagIdx < 0 || tagIdx > publishIdx || !tag.includes("require('./package.json').version") || !tag.includes("exit 1")) problems.push("게시 전에 태그와 package.json 버전을 비교해야 합니다.");
  const view = all[viewIdx] ?? "";
  if (viewIdx < 0 || viewIdx > publishIdx || !view.includes("exit 1")) problems.push("게시 전에 npm view로 기존 버전을 확인해야 합니다.");
  const summary = all[summaryIdx] ?? "";
  if (summaryIdx <= publishIdx || !summary.includes("Staged Packages")) problems.push("게시 뒤 승인 안내 요약이 필요합니다.");
  if (/continue-on-error|always\(\)/.test(text)) problems.push("continue-on-error·always()는 쓰지 않습니다.");
  return problems;
}

export const MCP_PUBLISHER = { version: "1.8.7", sha256: "00b21004149a4ce66f0782508ae4a2bce67d1bea395a8da0bd8028159fb59579", asset: "mcp-publisher_linux_amd64.tar.gz" } as const;

export function mcpRegistryProblems(text: string): string[] {
  const problems: string[] = [];
  if (!/^on:\n {2}workflow_dispatch:\npermissions:\n/m.test(text)) problems.push("트리거는 workflow_dispatch 하나여야 합니다.");
  if (/^ {2}(push|pull_request|pull_request_target|schedule|workflow_run|workflow_call|repository_dispatch|release|merge_group):/m.test(text) || /branches:|tags:|cron:/.test(text)) problems.push("workflow_dispatch 외 트리거가 있습니다.");
  if (JSON.stringify(topPermissions(text)) !== JSON.stringify({ contents: "read", "id-token": "write" }) || (text.match(/^[ \t]*permissions:/gm)?.length ?? 0) !== 1) problems.push("권한은 contents: read, id-token: write 두 개여야 합니다.");
  if (secretNames(text).length > 0 || /secrets\.|github\.token|_TOKEN\b/.test(text)) problems.push("토큰·시크릿 참조가 있습니다.");
  if (!/^concurrency:\n {2}group: mcp-registry\n {2}cancel-in-progress: false\n/m.test(text)) problems.push("concurrency(mcp-registry, cancel-in-progress: false)가 필요합니다.");
  if (!/^ {4}timeout-minutes: \d+$/m.test(text)) problems.push("timeout-minutes가 필요합니다.");
  const jobsPart = text.split("\njobs:\n")[1] ?? "";
  if ((jobsPart.match(/^ {2}[\w-]+:\s*$/gm)?.length ?? 0) !== 1 || !/^ {4}if: github\.ref == 'refs\/heads\/main'$/m.test(text)) problems.push("main에서만 실행되는 job 하나여야 합니다.");
  if (/^ {8}if:/m.test(text) || /continue-on-error|always\(\)/.test(text)) problems.push("단계 if·continue-on-error·always()는 쓰지 않습니다.");
  const ver = /^ {6}MCP_PUBLISHER_VERSION: "([^"]*)"$/m.exec(text)?.[1];
  const sha = /^ {6}MCP_PUBLISHER_SHA256: "([^"]*)"$/m.exec(text)?.[1];
  if (ver !== MCP_PUBLISHER.version || sha !== MCP_PUBLISHER.sha256 || !/^\d+\.\d+\.\d+$/.test(ver ?? "") || !/^[0-9a-f]{64}$/.test(sha ?? "")) problems.push("mcp-publisher 버전과 sha256은 고정값이어야 합니다.");
  if (/releases\/latest|\/latest\/|@latest|:latest/.test(text)) problems.push("latest 같은 가변 참조는 쓰지 않습니다.");
  const inst = block(text, "sha256sum -c");
  if (!inst.includes("releases/download/v${MCP_PUBLISHER_VERSION}/") || !inst.includes(MCP_PUBLISHER.asset) || !inst.includes('"${MCP_PUBLISHER_SHA256}  ${asset}" | sha256sum -c -') || inst.indexOf("sha256sum -c") > inst.indexOf("tar -xzf")) problems.push("publisher는 고정 버전을 내려받아 sha256 확인 뒤 풀어야 합니다.");
  const checkoutIdx = stepIndex(text, /^uses: actions\/checkout@/m);
  const ciIdx = stepIndex(text, /^run: npm ci\s*$/m);
  const verifyIdx = stepIndex(text, /^run: npm run verify\s*$/m);
  const npmIdx = stepIndex(text, /npm view /);
  const installIdx = stepIndex(text, /sha256sum -c/);
  const loginIdx = stepIndex(text, /^ {8}run: \.\/mcp-publisher login github-oidc\s*$/m);
  const publishIdx = stepIndex(text, /^ {8}run: \.\/mcp-publisher publish\s*$/m);
  if (!(checkoutIdx === 1 && checkoutIdx < ciIdx && ciIdx < verifyIdx && verifyIdx < npmIdx && npmIdx < installIdx && installIdx < loginIdx && loginIdx < publishIdx)) problems.push("단계 순서는 checkout → npm ci → npm run verify → npm 공개 확인 → publisher 설치·sha256 → login github-oidc → publish여야 합니다.");
  if ((text.match(/mcp-publisher publish/g)?.length ?? 0) !== 1 || (text.match(/mcp-publisher login/g)?.length ?? 0) !== 1) problems.push("login·publish는 한 번씩만 있어야 합니다.");
  const npm = steps(text)[npmIdx] ?? "";
  if (npmIdx < 0 || !npm.includes("mcpName") || !npm.includes("require('./server.json')") || !npm.includes("exit 1")) problems.push("게시 전에 npm 공개 버전의 mcpName을 server.json name과 비교해야 합니다.");
  if (/\bnpm (stage )?publish\b|gh release|curl[^\n]*-X|registry\.modelcontextprotocol\.io/.test(text)) problems.push("mcp-publisher publish 외 게시 경로가 있습니다.");
  return problems;
}
