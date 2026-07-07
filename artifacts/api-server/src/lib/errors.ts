/**
 * A user-actionable failure while executing an approved action — e.g. an
 * assignee name that doesn't match exactly one person. Surfaced to the
 * Secretary as a 422 with the message verbatim, so they can edit the action
 * and retry. Anything else thrown by an executor is a real bug and returns
 * a generic 500.
 */
export class ActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActionError";
  }
}
