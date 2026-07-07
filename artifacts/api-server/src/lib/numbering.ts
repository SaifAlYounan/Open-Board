import { db, votesTable, tasksTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

// A drizzle transaction handle or the root db — both expose the same query API.
export type DbClient = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

async function nextval(dbc: DbClient, seq: "resolution_seq" | "task_seq"): Promise<number> {
  const result = await dbc.execute(sql.raw(`SELECT nextval('${seq}') AS seq`));
  const rows = (result as unknown as { rows?: Array<{ seq: string | number }> }).rows ?? (result as unknown as Array<{ seq: string | number }>);
  const row = Array.isArray(rows) ? rows[0] : undefined;
  return Number(row?.seq ?? 0);
}

/**
 * Allocate the next free resolution number (RES-{ABBREV}-{YEAR}-{SEQ}).
 * Sequences are monotonic per call, so concurrent allocations never collide
 * with each other; the existence check skips over legacy count-derived numbers.
 */
export async function nextResolutionNumber(dbc: DbClient, abbrev: string): Promise<string> {
  const year = new Date().getFullYear();
  for (let i = 0; i < 50; i++) {
    const seq = await nextval(dbc, "resolution_seq");
    const candidate = `RES-${abbrev}-${year}-${String(seq).padStart(3, "0")}`;
    const [existing] = await dbc
      .select({ id: votesTable.id })
      .from(votesTable)
      .where(eq(votesTable.resolutionNumber, candidate))
      .limit(1);
    if (!existing) return candidate;
  }
  throw new Error("Could not allocate a free resolution number after 50 attempts");
}

/** Allocate the next free task number (TASK-{YEAR}-{SEQ}). Same strategy. */
export async function nextTaskNumber(dbc: DbClient): Promise<string> {
  const year = new Date().getFullYear();
  for (let i = 0; i < 50; i++) {
    const seq = await nextval(dbc, "task_seq");
    const candidate = `TASK-${year}-${String(seq).padStart(3, "0")}`;
    const [existing] = await dbc
      .select({ id: tasksTable.id })
      .from(tasksTable)
      .where(eq(tasksTable.taskNumber, candidate))
      .limit(1);
    if (!existing) return candidate;
  }
  throw new Error("Could not allocate a free task number after 50 attempts");
}
