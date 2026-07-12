import { describe, it } from "vitest";

/**
 * Suite wrapper for *.integration.test.ts files that require a live Postgres.
 *
 * These suites previously used `HAS_DB ? describe : describe.skip`, so a contributor
 * running `pnpm test` with no DATABASE_URL got a silent green on every integration
 * guarantee in the security model. That false pass is itself a finding — an acceptance
 * test that "passes" by not running proves nothing.
 *
 * Contract:
 *   - DATABASE_URL set             -> run the suite.
 *   - DATABASE_URL unset + SKIP_DB_TESTS=1  -> skip, with a loud warning (explicit opt-out).
 *   - DATABASE_URL unset, no opt-out        -> the suite FAILS with one red test, so the
 *                                              run cannot report green while the guarantee
 *                                              is unverified.
 */
export function integrationSuite(name: string, fn: () => void): void {
  if (process.env.DATABASE_URL) {
    describe(name, fn);
    return;
  }

  if (process.env.SKIP_DB_TESTS === "1") {
    // eslint-disable-next-line no-console
    console.warn(
      `[integration] SKIPPING "${name}": DATABASE_URL is unset and SKIP_DB_TESTS=1. ` +
        `This suite's security guarantees are UNVERIFIED in this run.`,
    );
    describe.skip(name, fn);
    return;
  }

  describe(name, () => {
    it("requires a live Postgres (set DATABASE_URL, or SKIP_DB_TESTS=1 to opt out loudly)", () => {
      throw new Error(
        `Integration suite "${name}" needs DATABASE_URL pointing at a live Postgres. ` +
          `It covers a security guarantee and must not silently pass. Set DATABASE_URL, ` +
          `or set SKIP_DB_TESTS=1 to explicitly (and loudly) opt out.`,
      );
    });
  });
}
