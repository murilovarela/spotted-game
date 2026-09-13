import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    exclude: ["**/*.integration.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      reportsDirectory: "./coverage",
      // The ratchet covers the pure shared core. Stream directories hold I/O (server
      // actions, API clients) that unit tests cannot reach; a stream that adds a pure
      // module opts it in by narrowing its own exclude here — a visible, reviewable act.
      include: ["src/lib/**/*.ts"],
      exclude: ["**/__tests__/**", "src/lib/games/**", "src/lib/generation/**", "src/lib/auth.ts"],
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
