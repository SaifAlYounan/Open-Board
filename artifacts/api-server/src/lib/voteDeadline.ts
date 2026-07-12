import type { Request } from "express";
import { db, votesTable, approvalRulesTable, peopleTable } from "@workspace/db";
import { and, eq, lt, isNotNull, sql } from "drizzle-orm";
import { loadEvaluationContext, evaluateOutcome, mintCertificate } from "./voteClose";
import { auditInTx } from "./auditLog";
import { sendVoteDeadlineNotice } from "./mailer";
import { emitInvalidate } from "./realtime";
import { triggerWorkflowNextStage } from "./workflowTrigger";
import { logger } from "./logger";

/**
 * Deadline enforcement (external-review item 4). `deadlineBehavior` was
 * stored, rendered in the UI, and never fired — there was no scheduler and no
 * lazy check anywhere. Enforcement is now LAZY (every read/cast path that
 * touches an open vote applies the policy first) plus a coarse hourly sweep
 * for votes nobody reads — lapse mints a certificate, so it must not wait for
 * a viewer.
 *
 * Behaviors, per the approval rule (default "lapse"):
 *   lapse   — close the vote as `lapsed` over the ballots received, mint the
 *             signed certificate, audit.
 *   extend  — push the deadline ONCE by rule.extendDays (default 7), audit;
 *             when the extended deadline also passes, fall through to lapse.
 *   notify  — audit + best-effort email to the admins, exactly once; the vote
 *             stays open.
 *
 * Idempotent and race-safe: the vote row is taken FOR UPDATE, and each
 * behavior re-checks its own marker (status, deadlineExtendedAt,
 * deadlineNotifiedAt) inside the lock.
 */

export type DeadlineOutcome = "noop" | "lapsed" | "extended" | "notified";

// Deadline events run outside any HTTP request; auditInTx reads only
// req.user?.id and the client ip, so a bare object attributes them to the
// system (personId null, ip "unknown").
const SYSTEM_REQ = {} as Request;

export async function applyDeadlinePolicy(voteId: string): Promise<DeadlineOutcome> {
  const result = await db.transaction(async (tx): Promise<{ outcome: DeadlineOutcome; boardId: string | null; title?: string; resolutionNumber?: string; status?: string }> => {
    const [vote] = await tx.select().from(votesTable).where(eq(votesTable.id, voteId)).for("update");
    if (!vote || vote.status !== "open" || !vote.deadline || vote.deadline.getTime() > Date.now()) {
      return { outcome: "noop", boardId: vote?.boardId ?? null };
    }
    const [rule] = await tx.select().from(approvalRulesTable).where(eq(approvalRulesTable.voteId, voteId));
    const behavior = rule?.deadlineBehavior ?? "lapse";

    if (behavior === "extend" && !vote.deadlineExtendedAt) {
      const days = rule?.extendDays ?? 7;
      const newDeadline = new Date(vote.deadline.getTime() + days * 24 * 60 * 60 * 1000);
      await tx
        .update(votesTable)
        .set({ deadline: newDeadline, deadlineExtendedAt: new Date() })
        .where(eq(votesTable.id, voteId));
      await auditInTx(tx, SYSTEM_REQ, "vote_deadline_extended", "vote", voteId, {
        days,
        oldDeadline: vote.deadline.toISOString(),
        newDeadline: newDeadline.toISOString(),
      });
      return { outcome: "extended", boardId: vote.boardId };
    }

    if (behavior === "notify") {
      if (vote.deadlineNotifiedAt) return { outcome: "noop", boardId: vote.boardId };
      await tx.update(votesTable).set({ deadlineNotifiedAt: new Date() }).where(eq(votesTable.id, voteId));
      await auditInTx(tx, SYSTEM_REQ, "vote_deadline_notify", "vote", voteId, {
        deadline: vote.deadline.toISOString(),
        voteTitle: vote.title,
      });
      return { outcome: "notified", boardId: vote.boardId, title: vote.title, resolutionNumber: vote.resolutionNumber };
    }

    // lapse — the default, and where "extend" lands after its one extension.
    const ctx = await loadEvaluationContext(vote, tx);
    const closedAt = new Date();
    const cert = await mintCertificate(vote, "lapsed", closedAt, ctx);
    await tx.update(votesTable).set({ status: "lapsed", closedAt, ...cert }).where(eq(votesTable.id, voteId));
    await auditInTx(tx, SYSTEM_REQ, "vote_lapsed_deadline", "vote", voteId, {
      deadline: vote.deadline.toISOString(),
      behavior,
      voteTitle: vote.title,
      votesCast: ctx.tally.votesCast,
    });
    return { outcome: "lapsed", boardId: vote.boardId, status: "lapsed" };
  });

  // Post-commit side effects only — never inside the row lock.
  if (result.outcome === "lapsed" || result.outcome === "extended") {
    emitInvalidate("votes", { boardId: result.boardId, id: voteId });
  }
  if (result.outcome === "lapsed") {
    setImmediate(() =>
      triggerWorkflowNextStage(voteId, "lapsed").catch((err) => logger.error({ err, voteId }, "Workflow trigger failed")),
    );
  }
  if (result.outcome === "notified") {
    setImmediate(async () => {
      try {
        const admins = await db.select().from(peopleTable).where(and(eq(peopleTable.role, "admin"), eq(peopleTable.active, true)));
        for (const a of admins) {
          if (a.email) await sendVoteDeadlineNotice(a.email, a.name ?? "Administrator", result.title ?? "", result.resolutionNumber ?? "");
        }
      } catch (err) {
        logger.warn({ err, voteId }, "Deadline notice emails failed — the audited event remains the record");
      }
    });
  }
  return result.outcome;
}

// The sweep is bounded; if a deployment ever accumulates more expired open
// votes than this in one hour, the remainder is logged loudly and picked up
// by the next sweep — never silently dropped.
const SWEEP_LIMIT = 200;

/** One pass over every open vote whose deadline has passed. */
export async function sweepExpiredVotes(): Promise<void> {
  const expired = await db
    .select({ id: votesTable.id })
    .from(votesTable)
    .where(and(eq(votesTable.status, "open"), isNotNull(votesTable.deadline), lt(votesTable.deadline, sql`now()`)))
    .limit(SWEEP_LIMIT);
  if (expired.length === SWEEP_LIMIT) {
    logger.warn({ limit: SWEEP_LIMIT }, "Deadline sweep hit its per-pass cap — remaining expired votes defer to the next pass");
  }
  for (const { id } of expired) {
    try {
      const outcome = await applyDeadlinePolicy(id);
      if (outcome !== "noop") logger.info({ voteId: id, outcome }, "Deadline policy applied by sweep");
    } catch (err) {
      logger.error({ err, voteId: id }, "Deadline policy failed for vote — will retry next sweep");
    }
  }
}

let sweepTimer: NodeJS.Timeout | null = null;

/** Start the hourly sweep (plus one pass at boot). Idempotent. */
export function startDeadlineSweep(intervalMs = 60 * 60 * 1000): void {
  if (sweepTimer) return;
  setImmediate(() => sweepExpiredVotes().catch((err) => logger.error({ err }, "Startup deadline sweep failed")));
  sweepTimer = setInterval(() => {
    sweepExpiredVotes().catch((err) => logger.error({ err }, "Deadline sweep failed"));
  }, intervalMs);
  sweepTimer.unref(); // never keep the process alive just for the sweep
}

export function stopDeadlineSweep(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}

/**
 * Route helper: enforce the deadline for a vote the caller just loaded, and
 * report whether anything changed (so the route re-reads the row). Cheap in
 * the common case — a pure in-memory check, no extra query.
 */
export async function enforceDeadlineIfPassed(vote: { id: string; status: string | null; deadline: Date | null }): Promise<boolean> {
  if (vote.status !== "open" || !vote.deadline || vote.deadline.getTime() > Date.now()) return false;
  return (await applyDeadlinePolicy(vote.id)) !== "noop";
}
