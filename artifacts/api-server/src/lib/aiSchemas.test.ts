import { describe, it, expect } from "vitest";
import { validateActionData, ACTION_TYPES } from "./aiSchemas";

describe("validateActionData", () => {
  it("rejects an unknown action type", () => {
    const r = validateActionData("drop_tables", { foo: "bar" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/unknown action type/i);
  });

  it("accepts every declared action type with minimal valid data", () => {
    for (const type of ACTION_TYPES) {
      const data =
        type === "create_workflow"
          ? { stages: [{ title: "FAC Endorsement", board: "FAC" }] }
          : { description: "x" };
      const r = validateActionData(type, data);
      expect(r.ok, `${type} should validate`).toBe(true);
    }
  });

  it("requires a non-empty stages array for create_workflow", () => {
    expect(validateActionData("create_workflow", { stages: [] }).ok).toBe(false);
    expect(validateActionData("create_workflow", {}).ok).toBe(false);
    expect(validateActionData("create_workflow", { details: { stages: [{ title: "A", board: "BoD" }] } }).ok).toBe(true);
  });

  it("rejects wrong-typed fields (deadline as a number)", () => {
    const r = validateActionData("create_vote", { deadline: 12345 });
    expect(r.ok).toBe(false);
  });

  it("rejects an over-long string field", () => {
    const r = validateActionData("create_task", { task: "x".repeat(5000) });
    expect(r.ok).toBe(false);
  });

  it("tolerates unknown extra keys but keeps typed ones", () => {
    const r = validateActionData("create_task", { task: "Do the thing", assignee: "Jane", surprise: "ignored" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.task).toBe("Do the thing");
      expect(r.data.assignee).toBe("Jane");
    }
  });

  it("passes through a nested details object for create_meeting", () => {
    const r = validateActionData("create_meeting", {
      description: "Q3 board meeting",
      details: { agenda_items: [{ title: "Approve budget", type: "decision" }] },
    });
    expect(r.ok).toBe(true);
  });
});
