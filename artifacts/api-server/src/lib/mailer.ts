import nodemailer, { type Transporter } from "nodemailer";
import { db, organizationsTable } from "@workspace/db";
import { logger } from "./logger";

/**
 * Outbound email — strictly additive delivery for the password-reset flow.
 *
 * Configured entirely from the environment (SMTP_HOST/PORT/SECURE/USER/PASS/FROM,
 * plus APP_BASE_URL for building links). When SMTP_HOST is unset the mailer is
 * a no-op and every flow behaves exactly as before (reset tokens logged only).
 *
 * Every send is fire-and-forget: sendMail failures are logged and swallowed so
 * an SMTP outage can neither 500 a request nor leak account existence through
 * response timing. Callers must NOT await the result on a request path.
 */

let transport: Transporter | null | undefined; // undefined = not yet resolved

function buildTransportFromEnv(): Transporter | null {
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = process.env.SMTP_SECURE === "true";
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  return nodemailer.createTransport({
    host,
    port,
    secure,
    ...(user && pass ? { auth: { user, pass } } : {}),
  });
}

function getTransport(): Transporter | null {
  if (transport === undefined) transport = buildTransportFromEnv();
  return transport;
}

/** Test seam: inject a fake transport (e.g. nodemailer's jsonTransport). */
export function _setTransportForTests(t: Transporter | null | undefined): void {
  transport = t;
}

export function mailerConfigured(): boolean {
  return getTransport() !== null;
}

/** One-line boot notice — called once at server start. */
export function logMailerStatus(): void {
  if (mailerConfigured()) {
    logger.info({ host: process.env.SMTP_HOST }, "SMTP configured — password emails will be delivered");
  } else {
    logger.info("SMTP not configured — password reset links are logged to the server log only (set SMTP_HOST to enable email delivery)");
  }
}

/** Organization name for email wording — DB first, ORG_NAME env as fallback. */
async function getOrgName(): Promise<string> {
  try {
    const [org] = await db.select().from(organizationsTable).limit(1);
    if (org?.name) return org.name;
  } catch {
    // DB unavailable — fall through to env
  }
  return process.env.ORG_NAME || "your organization";
}

function resetLink(token: string): string {
  const base = (process.env.APP_BASE_URL || "http://localhost:5173").replace(/\/+$/, "");
  return `${base}/reset-password?token=${token}`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

function renderResetEmail(orgName: string, name: string, link: string): EmailContent {
  const subject = `Password reset — ${orgName}`;
  const text = [
    `Hello ${name},`,
    ``,
    `A password reset was requested for your ${orgName} board portal account.`,
    `Open the link below to choose a new password (valid for 1 hour):`,
    ``,
    link,
    ``,
    `If you did not request this, you can ignore this email — your password is unchanged.`,
  ].join("\n");
  const html = `<p>Hello ${escapeHtml(name)},</p>
<p>A password reset was requested for your ${escapeHtml(orgName)} board portal account.
Open the link below to choose a new password (valid for 1 hour):</p>
<p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>
<p>If you did not request this, you can ignore this email — your password is unchanged.</p>`;
  return { subject, text, html };
}

function renderInviteEmail(orgName: string, name: string, link: string): EmailContent {
  const subject = `Your ${orgName} board portal account`;
  const text = [
    `Hello ${name},`,
    ``,
    `An account has been created for you on the ${orgName} board portal.`,
    `Open the link below to set your password and sign in:`,
    ``,
    link,
    ``,
    `If you were not expecting this, please contact your board secretary.`,
  ].join("\n");
  const html = `<p>Hello ${escapeHtml(name)},</p>
<p>An account has been created for you on the ${escapeHtml(orgName)} board portal.
Open the link below to set your password and sign in:</p>
<p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>
<p>If you were not expecting this, please contact your board secretary.</p>`;
  return { subject, text, html };
}

async function deliver(to: string, content: EmailContent): Promise<unknown> {
  const t = getTransport();
  if (!t) return null;
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || "no-reply@localhost";
  return t.sendMail({ from, to, subject: content.subject, text: content.text, html: content.html });
}

function renderDeadlineNotice(orgName: string, name: string, voteTitle: string, resolutionNumber: string): EmailContent {
  const subject = `[${orgName}] Vote deadline passed: ${resolutionNumber}`;
  const text = [
    `Hello ${name},`,
    ``,
    `The voting deadline for resolution ${resolutionNumber} — "${voteTitle}" — has passed.`,
    `Its approval rule is set to "notify", so the vote remains OPEN until it is resolved or lapsed.`,
    ``,
    `Please review it in the board portal.`,
  ].join("\n");
  const html = `<p>Hello ${escapeHtml(name)},</p>
<p>The voting deadline for resolution ${escapeHtml(resolutionNumber)} — “${escapeHtml(voteTitle)}” — has passed.
Its approval rule is set to <b>notify</b>, so the vote remains <b>open</b> until it is resolved or lapsed.</p>
<p>Please review it in the board portal.</p>`;
  return { subject, text, html };
}

/**
 * Notify an admin that a "notify"-behavior vote passed its deadline
 * (external-review item 4). Best-effort: never throws, failures are logged —
 * the audited deadline_notify event is the durable record either way.
 */
export async function sendVoteDeadlineNotice(to: string, name: string, voteTitle: string, resolutionNumber: string): Promise<unknown> {
  try {
    const orgName = await getOrgName();
    const info = await deliver(to, renderDeadlineNotice(orgName, name, voteTitle, resolutionNumber));
    if (info) logger.info({ to, resolutionNumber }, "Vote deadline notice sent");
    return info;
  } catch (err) {
    logger.warn({ err, to, resolutionNumber }, "Vote deadline notice failed — the audited deadline event remains the record");
    return null;
  }
}

/**
 * Send the forgot-password reset link. Never throws — failures are logged.
 * Returns the transport result (useful with jsonTransport in tests).
 */
export async function sendPasswordResetEmail(to: string, name: string, token: string): Promise<unknown> {
  try {
    const orgName = await getOrgName();
    const info = await deliver(to, renderResetEmail(orgName, name, resetLink(token)));
    if (info) logger.info({ to }, "Password reset email sent");
    return info;
  } catch (err) {
    logger.warn({ err, to }, "Password reset email failed — token remains valid; relay via secure channel");
    return null;
  }
}

/**
 * Send the invite-style "account created — set your password" email for an
 * admin-created user. Reuses the reset-token flow; NEVER contains a password.
 * Never throws — failures are logged.
 */
export async function sendInviteEmail(to: string, name: string, token: string): Promise<unknown> {
  try {
    const orgName = await getOrgName();
    const info = await deliver(to, renderInviteEmail(orgName, name, resetLink(token)));
    if (info) logger.info({ to }, "Account invite email sent");
    return info;
  } catch (err) {
    logger.warn({ err, to }, "Account invite email failed — the one-time password shown to the secretary still works");
    return null;
  }
}
