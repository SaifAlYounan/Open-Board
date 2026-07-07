import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Single locale for the whole app so dates render consistently everywhere.
const LOCALE = "en-GB"

/**
 * Format a date. Date-only strings (YYYY-MM-DD) are parsed as LOCAL dates so a
 * user in a negative-UTC timezone doesn't see the day shift back by one — the
 * bug that previously affected every list page except vote-detail.
 */
export function formatDate(d: string | Date | null | undefined): string {
  if (!d) return "—"
  if (typeof d === "string") {
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.exec(d)
    if (dateOnly) {
      const [yr, mo, dy] = d.split("-").map(Number)
      return new Date(yr, mo - 1, dy).toLocaleDateString(LOCALE, { day: "numeric", month: "short", year: "numeric" })
    }
  }
  return new Date(d).toLocaleDateString(LOCALE, { day: "numeric", month: "short", year: "numeric" })
}

export function formatDateTime(d: string | Date | null | undefined): string {
  if (!d) return "—"
  return new Date(d).toLocaleString(LOCALE, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
}

/** True when a due date is in the past (date-only comparison, timezone-safe). */
export function isOverdue(dueDate: string | null | undefined): boolean {
  if (!dueDate) return false
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.exec(dueDate)
  const due = dateOnly
    ? (() => { const [y, m, d] = dueDate.split("-").map(Number); return new Date(y, m - 1, d) })()
    : new Date(dueDate)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return due < today
}

/** Two-letter initials from a person's name, for avatar chips. */
export function initials(name: string | null | undefined): string {
  if (!name) return "?"
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?"
}

/**
 * The route a given user role can actually reach for an entity, or null if that
 * role has no detail page for it (render as plain text instead of a dead link).
 * Fixes AI-search source links that pointed at member-only /board routes or "#".
 */
export function entityHref(
  entityType: string,
  entityId: string,
  role: string | undefined,
): string | null {
  const t = entityType.toLowerCase()
  switch (role) {
    case "admin":
      if (t === "vote") return `/secretary/votes/${entityId}`
      if (t === "meeting") return `/secretary/meetings/${entityId}`
      if (t === "minutes") return `/secretary/minutes/${entityId}`
      if (t === "task") return `/secretary/tasks/${entityId}`
      return null
    case "member":
      if (t === "vote") return `/board/vote/${entityId}`
      if (t === "meeting") return `/board/meetings/${entityId}`
      if (t === "minutes") return `/board/minutes/${entityId}`
      return null
    case "management":
      if (t === "task") return `/management/task/${entityId}`
      return null
    default:
      return null
  }
}
