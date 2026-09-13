#!/usr/bin/env node
// PreToolUse: deny writes to paths an agent must never touch.
// Exit 2 blocks the tool call; stderr becomes the reason Claude sees.
import { readInput } from "./read-input.mjs";

const input = await readInput();
const p = input.tool_input?.file_path ?? input.tool_input?.notebook_path ?? "";
if (!p) process.exit(0);

const deny = (msg) => { console.error(`BLOCKED: ${msg}`); process.exit(2); };
const base = p.split(/[\\/]/).pop();

if (/^\.env($|\.)/.test(base) && base !== ".env.example") {
  deny("Secrets are never written by an agent. Add the variable name to .env.example instead.");
}
if (/(^|[\\/])db[\\/]migrations[\\/]/.test(p)) {
  deny("Generated migrations are not hand-edited. Change src/db/schema.ts and run: npm run db:generate");
}
process.exit(0);
