/**
 * Runs `npm run seed -- --json` as the given user and writes the result to
 * `e2e/.auth/seed.json` (the same shape `seed()` in ./seed-data reads, including `user`).
 * Extracted from global-setup so a spec that needs its own fresh games — `ui.spec.ts`,
 * whose beforeAll must not depend on execution order or which project is running — can
 * reseed on demand instead of only once per run.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

export function reseed(userId: string, email: string): void {
  const out = execFileSync("npm", ["run", "-s", "seed", "--", "--json"], {
    env: { ...process.env, SEED_MASTER_ID: userId },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  const lastLine = out.trim().split("\n").at(-1) ?? "";
  mkdirSync("e2e/.auth", { recursive: true });
  writeFileSync("e2e/.auth/seed.json", JSON.stringify({ ...JSON.parse(lastLine), user: { id: userId, email } }));
}
