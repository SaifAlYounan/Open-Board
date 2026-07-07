import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Unit tests run anywhere. Integration tests (*.integration.test.ts) need a
    // Postgres at DATABASE_URL and are skipped automatically when it's unset.
    include: ["src/**/*.test.ts"],
    environment: "node",
    globals: true,
  },
});
