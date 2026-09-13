#!/usr/bin/env node
// Stop: refuse to end the turn while the build is broken.
// Emits {"decision":"block","reason":...} so failures re-enter the agent loop.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { readInput } from "./read-input.mjs";

const MAX_ATTEMPTS = 3;
const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const countFile = join(root, ".claude", ".stop-count");

const readCount = () => { try { return Number(readFileSync(countFile, "utf8").trim()) || 0; } catch { return 0; } };
const writeCount = (n) => { try { mkdirSync(join(root, ".claude"), { recursive: true }); writeFileSync(countFile, String(n)); } catch {} };
const emit = (o) => { process.stdout.write(JSON.stringify(o)); process.exit(0); };

const input = await readInput();
const count = readCount();

// Three consecutive blocks means the agent is stuck on something needing a human decision.
if (input.stop_hook_active && count >= MAX_ATTEMPTS) {
  writeCount(0);
  emit({ systemMessage: `Verification still failing after ${MAX_ATTEMPTS} attempts. Stopping for human review.` });
}

const checks = [
  ["typecheck", "npx tsc --noEmit"],
  ["lint", "npx eslint . --max-warnings=0"],
  ["unit", "npx vitest run --reporter=dot"],
];

const failures = [];
for (const [label, cmd] of checks) {
  try {
    execSync(cmd, { cwd: root, stdio: "pipe" });
  } catch (e) {
    const out = `${e.stdout ?? ""}${e.stderr ?? ""}`.split("\n").slice(-40).join("\n");
    failures.push(`--- ${label} ---\n${out}`);
  }
}

if (failures.length) {
  writeCount(count + 1);
  emit({ decision: "block", reason: `Verification failed. Fix these, then finish.\n\n${failures.join("\n\n")}` });
}

writeCount(0);
process.exit(0);
