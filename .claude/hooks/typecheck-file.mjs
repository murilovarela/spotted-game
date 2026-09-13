#!/usr/bin/env node
// PostToolUse: fast type feedback on the file just written.
// The write already happened, so exit 2 here surfaces stderr to Claude as feedback.
import { execSync } from "node:child_process";
import { readInput } from "./read-input.mjs";

const input = await readInput();
const p = input.tool_input?.file_path ?? "";
if (!/\.tsx?$/.test(p)) process.exit(0);

const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
try {
  execSync("npx tsc --noEmit", { cwd: root, stdio: "pipe" });
} catch (e) {
  const out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
  const base = p.split(/[\\/]/).pop();
  const lines = out.split("\n").filter((l) => l.includes(base)).slice(0, 20);
  if (lines.length) {
    console.error(`Type errors in ${base}:\n${lines.join("\n")}`);
    process.exit(2);
  }
}
process.exit(0);
