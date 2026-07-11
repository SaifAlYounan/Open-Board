/**
 * A3 (P0.4 UX truth) — /ai/status must not tell an operator to "set the key"
 * when the key is already set and only AI_ALLOW_EXTERNAL_PROVIDER is missing.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { aiStatusInfo } from "./ai";

function clearEnv() {
  delete process.env.AI_PROVIDER;
  delete process.env.AI_BASE_URL;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
  delete process.env.AI_ALLOW_EXTERNAL_PROVIDER;
}

beforeEach(clearEnv);
afterEach(clearEnv);

describe("aiStatusInfo (A3)", () => {
  it("no key/provider → not_configured", () => {
    const s = aiStatusInfo();
    expect(s.configured).toBe(false);
    expect(s.reason).toBe("not_configured");
  });

  it("key set but external NOT acknowledged → external_not_acknowledged, message names the flag (not the key)", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-x";
    const s = aiStatusInfo();
    expect(s.configured).toBe(false);
    expect(s.reason).toBe("external_not_acknowledged");
    expect(s.message).toContain("AI_ALLOW_EXTERNAL_PROVIDER");
  });

  it("key + acknowledgement → configured", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-x";
    process.env.AI_ALLOW_EXTERNAL_PROVIDER = "true";
    const s = aiStatusInfo();
    expect(s.configured).toBe(true);
    expect(s.reason).toBe("configured");
    expect(s.message).toBeNull();
  });
});
