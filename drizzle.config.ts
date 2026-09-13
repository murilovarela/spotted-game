import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";

// Same .env.local / .env resolution as Next itself.
loadEnvConfig(process.cwd());

// `generate` works offline; `migrate` / `push` / `studio` need the URL and fail loudly without it.
// DDL goes over the direct connection; the pooler is for the app.
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "";
if (!url) console.warn("DATABASE_URL is not set — only `drizzle-kit generate` will work.");

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
