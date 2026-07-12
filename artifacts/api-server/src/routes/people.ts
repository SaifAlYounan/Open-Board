import crypto from "crypto";
import { Router } from "express";
import bcrypt from "bcryptjs";
import {
  db,
  peopleTable,
  boardMembershipsTable,
  boardsTable,
  passwordResetTokensTable,
  voteRecordsTable,
  minutesSignaturesTable,
  auditTrailTable,
  attendanceTable,
  documentsTable,
  tasksTable,
} from "@workspace/db";
import { eq, and, inArray, sql, or, count } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../lib/auth";
import { auditInTx } from "../lib/auditLog";
import { sanitizeText } from "../lib/sanitize";
import { pick } from "../lib/pick";
import { parsePagination } from "../lib/pagination";
import { mailerConfigured, sendInviteEmail } from "../lib/mailer";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const router = Router();

router.param("id", (_req, res, next, id) => {
  if (!UUID_REGEX.test(id)) {
    res.status(400).json({ error: "Invalid id format" });
    return;
  }
  next();
});

// True if `personId` is the ONLY remaining active admin — used to block actions
// that would lock the organization out of its own administration.
async function isLastActiveAdmin(personId: string): Promise<boolean> {
  const admins = await db
    .select({ id: peopleTable.id })
    .from(peopleTable)
    .where(and(eq(peopleTable.role, "admin"), eq(peopleTable.active, true)));
  return admins.length === 1 && admins[0].id === personId;
}

router.get("/people", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const { limit, offset } = parsePagination(req.query);
  const people = await db.select().from(peopleTable).orderBy(peopleTable.name);
  const safe = people.map(({ passwordHash: _, ...p }) => p).slice(offset, offset + limit);
  res.json(safe);
});

const VALID_ROLES = ["admin", "member", "observer", "management"];
const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

router.post("/people", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const { email, password, name, role, title, avatarColor } = req.body;
  if (!email || !name || !role) {
    res.status(400).json({ error: "Required: email, name, role" });
    return;
  }

  if (!emailRegex.test(email)) {
    res.status(400).json({ error: "Invalid email format" });
    return;
  }

  if (!VALID_ROLES.includes(role)) {
    res.status(400).json({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(", ")}` });
    return;
  }

  // Password is optional: if the Secretary doesn't set one, generate a strong
  // one-time password and return it once so it can be relayed to the new user.
  // Either way the account is flagged to force a reset on first sign-in — the
  // Secretary never holds a member's permanent credentials.
  const generated = !password;
  const initialPassword = generated ? crypto.randomBytes(15).toString("base64url") : password;

  if (typeof initialPassword !== "string" || initialPassword.length < 12) {
    res.status(400).json({ error: "Password must be at least 12 characters" });
    return;
  }

  try {
    const passwordHash = await bcrypt.hash(initialPassword, 10);
    // Fail-closed (P0.6): the account and its audit entry commit together.
    const [person] = await db.transaction(async (tx) => {
      const rows = await tx
        .insert(peopleTable)
        .values({ email, passwordHash, name: sanitizeText(name), role, title: title ? sanitizeText(title) : title, avatarColor, mustResetPassword: true })
        .returning();
      await auditInTx(tx, req, "person_created", "person", rows[0].id, { email: rows[0].email, role: rows[0].role });
      return rows;
    });

    // Invite email (additive): when we generated the password AND SMTP is
    // configured, reuse the reset-token flow so the new user sets their own
    // password from a link. The email NEVER carries a password; the one-time
    // password below still goes to the Secretary exactly as before.
    if (generated && mailerConfigured()) {
      const inviteToken = crypto.randomBytes(32).toString("hex");
      const inviteTokenHash = crypto.createHash("sha256").update(inviteToken).digest("hex");
      const inviteExpiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72 h to accept an invite
      await db.insert(passwordResetTokensTable).values({ personId: person.id, tokenHash: inviteTokenHash, expiresAt: inviteExpiresAt });
      // Fire-and-forget — an SMTP failure must not fail the create request.
      void sendInviteEmail(person.email, person.name, inviteToken);
    }

    const { passwordHash: _, ...safe } = person;
    // Only surface the password when we generated it (the Secretary already
    // knows one they supplied themselves).
    res.status(201).json(generated ? { ...safe, oneTimePassword: initialPassword } : safe);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("unique") || msg.includes("duplicate")) {
      res.status(409).json({ error: "A person with this email already exists" });
    } else {
      res.status(500).json({ error: "Failed to create person" });
    }
  }
});

router.get("/people/:id", requireAuth, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const requester = req.user!;

  // Non-admins may only look up themselves or people they share a board with,
  // and only see directory fields — not email/role/account state.
  if (requester.role !== "admin" && id !== requester.id) {
    const myBoards = await db
      .select({ boardId: boardMembershipsTable.boardId })
      .from(boardMembershipsTable)
      .where(eq(boardMembershipsTable.personId, requester.id));
    const boardIds = myBoards.map((m) => m.boardId).filter((b): b is string => b != null);
    const shared = boardIds.length
      ? await db
          .select({ id: boardMembershipsTable.id })
          .from(boardMembershipsTable)
          .where(and(eq(boardMembershipsTable.personId, id), inArray(boardMembershipsTable.boardId, boardIds)))
      : [];
    if (shared.length === 0) {
      res.status(404).json({ error: "Person not found" });
      return;
    }
  }

  const [person] = await db.select().from(peopleTable).where(eq(peopleTable.id, id));
  if (!person) {
    res.status(404).json({ error: "Person not found" });
    return;
  }
  if (requester.role !== "admin" && id !== requester.id) {
    res.json({ id: person.id, name: person.name, title: person.title, avatarColor: person.avatarColor });
    return;
  }
  const { passwordHash: _, ...safe } = person;
  res.json(safe);
});

router.patch("/people/:id", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { name, title, avatarColor, role, active } = pick(req.body, ["name", "title", "avatarColor", "role", "active"] as (keyof typeof req.body)[]) as { name?: string; title?: string; avatarColor?: string; role?: string; active?: boolean };
  if (role != null && !VALID_ROLES.includes(role)) {
    res.status(400).json({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(", ")}` });
    return;
  }
  // Don't let the last active admin be demoted or deactivated — that would lock
  // the organization out of administration entirely.
  const demoting = role != null && role !== "admin";
  const deactivating = active === false;
  if ((demoting || deactivating) && (await isLastActiveAdmin(id))) {
    res.status(409).json({ error: "Cannot demote or deactivate the last active administrator." });
    return;
  }

  const updates: Record<string, unknown> = {};
  if (name != null) updates.name = sanitizeText(name);
  if (title != null) updates.title = sanitizeText(title);
  if (avatarColor != null) updates.avatarColor = avatarColor;
  if (role != null) updates.role = role;
  if (active != null) {
    updates.active = active;
    // Deactivation (or role-relevant reactivation) kills outstanding sessions immediately.
    if (active === false) updates.tokenVersion = sql`${peopleTable.tokenVersion} + 1`;
  }

  // Fail-closed (P0.6): the update and its audit entry commit together.
  const person = await db.transaction(async (tx) => {
    const [p] = await tx.update(peopleTable).set(updates).where(eq(peopleTable.id, id)).returning();
    if (!p) return null;
    await auditInTx(tx, req, "person_updated", "person", p.id, { changed: Object.keys(updates) });
    return p;
  });
  if (!person) {
    res.status(404).json({ error: "Person not found" });
    return;
  }
  const { passwordHash: _, ...safe } = person;
  res.json(safe);
});

router.delete("/people/:id", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (await isLastActiveAdmin(id)) {
    res.status(409).json({ error: "Cannot delete the last active administrator." });
    return;
  }

  // A person who has ACTED in the governance record — cast a ballot, signed
  // minutes, appeared on the audit trail, attended, uploaded, been assigned —
  // is part of that record and is never hard-deleted (external-review item 7:
  // this previously died on unguarded foreign keys as an unhandled 500).
  // Deactivate instead; the account keeps its history and loses all access.
  const [[ballots], [signatures], [auditRows], [attendance], [uploads], [assignedTasks]] = await Promise.all([
    db.select({ n: count() }).from(voteRecordsTable).where(or(eq(voteRecordsTable.personId, id), eq(voteRecordsTable.castBy, id))),
    db.select({ n: count() }).from(minutesSignaturesTable).where(eq(minutesSignaturesTable.personId, id)),
    db.select({ n: count() }).from(auditTrailTable).where(eq(auditTrailTable.personId, id)),
    db.select({ n: count() }).from(attendanceTable).where(or(eq(attendanceTable.personId, id), eq(attendanceTable.proxyHolderId, id))),
    db.select({ n: count() }).from(documentsTable).where(eq(documentsTable.uploadedBy, id)),
    db.select({ n: count() }).from(tasksTable).where(eq(tasksTable.assigneeId, id)),
  ]);
  const references: Record<string, number> = {
    ballots: ballots.n,
    signatures: signatures.n,
    auditEntries: auditRows.n,
    attendance: attendance.n,
    uploads: uploads.n,
    assignedTasks: assignedTasks.n,
  };
  const referenced = Object.entries(references).filter(([, n]) => n > 0);
  if (referenced.length > 0) {
    res.status(409).json({
      error:
        "This person is part of the governance record and cannot be hard-deleted. " +
        "Deactivate the account instead (PATCH { active: false }) — it keeps the record intact and revokes all access.",
      references: Object.fromEntries(referenced),
    });
    return;
  }

  // Fail-closed (P0.6): the delete and its audit entry commit together.
  await db.transaction(async (tx) => {
    await tx.delete(peopleTable).where(eq(peopleTable.id, id));
    await auditInTx(tx, req, "person_deleted", "person", id, {});
  });
  res.sendStatus(204);
});

export default router;
