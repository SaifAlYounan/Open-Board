/**
 * Unit tests for the mailer seam — uses nodemailer's jsonTransport so no SMTP
 * server (or network) is involved. Runs without a real database: @workspace/db
 * only needs DATABASE_URL to be SET at import; the org-name query then fails
 * fast and the mailer falls back to ORG_NAME.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import nodemailer from "nodemailer";

const TOKEN = "abc123token456";

function jsonTransport() {
  return nodemailer.createTransport({ jsonTransport: true });
}

describe("mailer", () => {
  let mailer: typeof import("./mailer");

  beforeAll(async () => {
    // @workspace/db throws at import when DATABASE_URL is unset; a dead URL is
    // fine — getOrgName catches the query failure and uses ORG_NAME.
    process.env.DATABASE_URL ||= "postgresql://nobody:nothing@127.0.0.1:9/nodb";
    mailer = await import("./mailer");
  });

  beforeEach(() => {
    process.env.APP_BASE_URL = "https://board.example.com";
    process.env.ORG_NAME = "Test Org";
    mailer._setTransportForTests(jsonTransport());
  });

  afterEach(() => {
    mailer._setTransportForTests(undefined); // back to env-resolved
    delete process.env.APP_BASE_URL;
  });

  it("is unconfigured when SMTP_HOST is unset (no-op sends)", async () => {
    mailer._setTransportForTests(null);
    expect(mailer.mailerConfigured()).toBe(false);
    const info = await mailer.sendPasswordResetEmail("a@b.c", "A", TOKEN);
    expect(info).toBeNull();
  });

  it("reset email contains the token link and product-neutral wording", async () => {
    const info: any = await mailer.sendPasswordResetEmail("user@example.com", "Ursula User", TOKEN);
    expect(info).toBeTruthy();
    const msg = JSON.parse(info.message);
    expect(msg.to[0].address).toBe("user@example.com");
    expect(msg.subject).toContain("Password reset");
    expect(msg.text).toContain(`https://board.example.com/reset-password?token=${TOKEN}`);
    expect(msg.html).toContain(`/reset-password?token=${TOKEN}`);
    // Product-neutral wording — org name from env/DB, no hardcoded brand.
    expect(msg.subject).toContain("Test Org");
    expect(msg.text).not.toMatch(/open board/i);
  });

  it("invite email contains the set-password link and NO password", async () => {
    const info: any = await mailer.sendInviteEmail("new@example.com", "Nina New", TOKEN);
    expect(info).toBeTruthy();
    const msg = JSON.parse(info.message);
    expect(msg.subject).toContain("account");
    expect(msg.text).toContain(`/reset-password?token=${TOKEN}`);
    // The invite must never carry a credential.
    expect(msg.text.toLowerCase()).not.toContain("one-time password");
    expect(msg.text).not.toMatch(/password is|password:\s/i);
    expect(msg.html).not.toMatch(/password is|password:\s/i);
  });

  it("swallows transport failures (never throws)", async () => {
    mailer._setTransportForTests({
      sendMail: async () => {
        throw new Error("SMTP down");
      },
    } as any);
    await expect(mailer.sendPasswordResetEmail("a@b.c", "A", TOKEN)).resolves.toBeNull();
    await expect(mailer.sendInviteEmail("a@b.c", "A", TOKEN)).resolves.toBeNull();
  });

  it("escapes HTML in names", async () => {
    const info: any = await mailer.sendPasswordResetEmail("x@y.z", `<script>alert(1)</script>`, TOKEN);
    const msg = JSON.parse(info.message);
    expect(msg.html).not.toContain("<script>");
    expect(msg.html).toContain("&lt;script&gt;");
  });
});
