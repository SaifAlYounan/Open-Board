import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Unit tests run anywhere. Integration tests (*.integration.test.ts) need a
    // Postgres at DATABASE_URL and are skipped automatically when it's unset.
    include: ["src/**/*.test.ts"],
    environment: "node",
    globals: true,

    // Integration suites all share ONE database, so they must not run in
    // parallel. Concurrently they raced each other in ways that had nothing to
    // do with the code under test: one suite's cleanup deleting rows another
    // suite still referenced (FK errors), several suites burning the same
    // account's login throttle, and — since the P0.6 fail-closed audit — every
    // audited mutation in every suite queuing on the single audit-chain
    // advisory lock, which could push a write-heavy suite past its timeout.
    //
    // Sequential files trade wall-clock for determinism. That is the right
    // trade for a suite whose job is to catch governance-correctness bugs: a
    // flaky failure teaches people to re-run rather than to look.
    fileParallelism: false,

    // These drive whole request paths against a real Postgres; 5 s is a
    // unit-test budget, not an integration one.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
