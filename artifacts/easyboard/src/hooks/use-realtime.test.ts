/**
 * Unit tests for the realtime invalidation mapping. The hook itself is a thin
 * effect (connect socket → invalidateForEvent on each event); the mapping is
 * where the logic lives, so that's what gets tested.
 */
import { describe, it, expect } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { invalidateForEvent, RESOURCE_PREFIXES } from "./use-realtime";

function seededClient(): QueryClient {
  const qc = new QueryClient();
  const keys: unknown[][] = [
    ["/api/votes"],
    ["/api/votes", { boardId: "b1" }],
    ["/api/votes/abc-123"],
    ["/api/tasks"],
    ["/api/meetings/xyz"],
    ["/api/pending-actions", { status: "pending" }],
    ["/api/dashboard/summary"],
    ["/api/boards"],
  ];
  for (const queryKey of keys) {
    qc.setQueryData(queryKey, { seeded: true });
  }
  return qc;
}

function invalidatedKeys(qc: QueryClient): string[] {
  return qc
    .getQueryCache()
    .getAll()
    .filter((q) => q.state.isInvalidated)
    .map((q) => String(q.queryKey[0]));
}

describe("invalidateForEvent", () => {
  it("invalidates list, param, and detail caches for the resource (plus dashboard)", () => {
    const qc = seededClient();
    invalidateForEvent(qc, "votes");
    const hit = invalidatedKeys(qc);
    expect(hit).toContain("/api/votes");
    expect(hit).toContain("/api/votes/abc-123");
    expect(hit).toContain("/api/dashboard/summary");
    // Unrelated caches untouched.
    expect(hit).not.toContain("/api/tasks");
    expect(hit).not.toContain("/api/boards");
  });

  it("invalidates pending actions for pendingActions events", () => {
    const qc = seededClient();
    invalidateForEvent(qc, "pendingActions");
    const hit = invalidatedKeys(qc);
    expect(hit).toContain("/api/pending-actions");
    expect(hit).not.toContain("/api/votes");
  });

  it("ignores unknown resources", () => {
    const qc = seededClient();
    invalidateForEvent(qc, "not-a-resource");
    expect(invalidatedKeys(qc)).toEqual([]);
  });

  it("covers every resource the server can emit", () => {
    for (const r of ["votes", "tasks", "documents", "meetings", "minutes", "pendingActions", "boards", "people"]) {
      expect(RESOURCE_PREFIXES[r]).toBeTruthy();
    }
  });
});
