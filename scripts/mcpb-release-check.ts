import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { checkMcpbFile, parseReleaseCheckArgs, type McpbIssue } from "./lib/mcpb-release.js";

async function main(): Promise<void> {
  const args = parseReleaseCheckArgs(process.argv.slice(2));
  const work = mkdtempSync(join(tmpdir(), "kpm-release-"));
  try {
    let last: string[] = [];
    for (let i = 1; i <= args.attempts; i++) {
      let reasons: string[];
      try {
        const res = await fetch(args.url, { redirect: "follow" });
        if (!res.ok) {
          reasons = [`HTTP ${res.status}`];
        } else {
          const file = join(work, "dl.mcpb");
          writeFileSync(file, Buffer.from(await res.arrayBuffer()));
          const issues: McpbIssue[] = checkMcpbFile(file, args.commit);
          reasons = issues.map((x) => `${x.code}: ${x.detail}`);
        }
      } catch (err) {
        reasons = [String(err)];
      }
      if (reasons.length === 0) {
        process.stdout.write(`MCPB RELEASE CHECK PASS (${args.commit.slice(0, 12)}, try ${i}/${args.attempts})\n`);
        return;
      }
      last = reasons;
      process.stderr.write(`try ${i}/${args.attempts}: ${reasons.join("; ")}\n`);
      if (i < args.attempts) await sleep(args.intervalMs);
    }
    throw new Error(last.join("; "));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`MCPB RELEASE CHECK FAIL: ${message}\n`);
  process.exitCode = 1;
});
