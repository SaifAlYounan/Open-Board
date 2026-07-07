import { describe, it, expect } from "vitest";
import { sanitizeText } from "./sanitize";

describe("sanitizeText", () => {
  it("strips HTML tags (leaving inner text as harmless plain text)", () => {
    // Tags are removed so nothing is executable; inner text survives as plain text.
    const out = sanitizeText("<script>alert(1)</script>hi");
    expect(out).not.toContain("<");
    expect(out).not.toContain(">");
    expect(sanitizeText("<b>bold</b>")).toBe("bold");
  });

  it("strips null bytes and control characters (prevents Postgres 500s)", () => {
    expect(sanitizeText("ab\x00cd")).toBe("abcd");
    expect(sanitizeText("x\x01\x07\x1fy\x7f")).toBe("xy");
  });

  it("caps length at 500 chars by default", () => {
    expect(sanitizeText("a".repeat(1000)).length).toBe(500);
  });

  it("respects a custom max length", () => {
    expect(sanitizeText("abcdef", 3)).toBe("abc");
  });

  it("trims surrounding whitespace", () => {
    expect(sanitizeText("  hello  ")).toBe("hello");
  });

  it("leaves ordinary text intact", () => {
    expect(sanitizeText("Approve the Q3 budget")).toBe("Approve the Q3 budget");
  });
});
