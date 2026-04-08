export function parsePagination(query: Record<string, unknown>) {
  const MAX_LIMIT = 200;
  const limit = Math.min(parseInt(query.limit as string) || 50, MAX_LIMIT);
  const offset = Math.max(parseInt(query.offset as string) || 0, 0);
  return { limit, offset };
}
