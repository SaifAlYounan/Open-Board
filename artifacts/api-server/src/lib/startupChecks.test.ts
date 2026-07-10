import { describe, it, expect } from "vitest";
import { checkStartupConfig } from "./startupChecks";

const PROD_URL = "postgresql://openboard:openboard@db:5432/openboard";
const SAFE_URL = "postgresql://openboard:s3cr3t-strong@db:5432/openboard";

describe("checkStartupConfig", () => {
  it("passes for a normal development config", () => {
    expect(() =>
      checkStartupConfig({ NODE_ENV: "development", DATABASE_URL: PROD_URL }),
    ).not.toThrow();
  });

  it("H1: refuses production boot with the default database password", () => {
    expect(() =>
      checkStartupConfig({ NODE_ENV: "production", DATABASE_URL: PROD_URL, DOMAIN: "board.example.com" }),
    ).toThrow(/default database password/i);
  });

  it("H1: allows production boot with a strong database password", () => {
    expect(() =>
      checkStartupConfig({ NODE_ENV: "production", DATABASE_URL: SAFE_URL, DOMAIN: "board.example.com" }),
    ).not.toThrow();
  });

  it("H1: tolerates a malformed DATABASE_URL in production (no crash on parse)", () => {
    expect(() =>
      checkStartupConfig({ NODE_ENV: "production", DATABASE_URL: "not-a-url", DOMAIN: "board.example.com" }),
    ).not.toThrow();
  });

  it("M1: refuses when DOMAIN is set but NODE_ENV is not production", () => {
    expect(() =>
      checkStartupConfig({ NODE_ENV: "development", DOMAIN: "board.example.com", DATABASE_URL: SAFE_URL }),
    ).toThrow(/NODE_ENV/);
  });

  it("M1: an empty DOMAIN does not trigger the production-intent check", () => {
    expect(() =>
      checkStartupConfig({ NODE_ENV: "development", DOMAIN: "   ", DATABASE_URL: SAFE_URL }),
    ).not.toThrow();
  });
});
