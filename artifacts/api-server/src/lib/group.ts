/**
 * Group rows by a key, skipping rows whose key is null/undefined. Used to turn a
 * single batched `inArray` result into per-parent buckets — the alternative to
 * one query per parent row (N+1).
 */
export function groupBy<T>(rows: T[], key: (row: T) => string | null | undefined): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    if (k == null) continue;
    const bucket = map.get(k);
    if (bucket) bucket.push(row);
    else map.set(k, [row]);
  }
  return map;
}
