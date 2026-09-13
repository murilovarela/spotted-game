import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { loadEnvConfig } from "@next/env";

// Same .env.local / .env resolution as Next itself. Vitest sets NODE_ENV=test before this
// file runs, and @next/env deliberately skips .env.local under NODE_ENV=test (the same rule
// Next.js applies) — so TEST_DATABASE_URL would never load. Unset it for this call only.
const env = process.env as Record<string, string | undefined>;
const nodeEnv = env.NODE_ENV;
delete env.NODE_ENV;
loadEnvConfig(process.cwd());
env.NODE_ENV = nodeEnv;

// Real database. Not part of `verify`; run with `npm run test:integration`.
export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.integration.test.ts"],
    environment: "node",
    fileParallelism: false, // tests truncate shared tables
    testTimeout: 20_000,
    // Test files run in a worker; forward what loadEnvConfig just set on this process.
    env: { TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? "" },
  },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
});
