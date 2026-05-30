/**
 * Persisted rows include `$createdAt` / `$updatedAt` (ISO strings).
 * No silent defaults: throw if missing or empty so bugs surface in development.
 */
export function assertRowTimestamps(row: Record<string, unknown>): {
  $createdAt: string;
  $updatedAt: string;
} {
  const $createdAt = row.$createdAt;
  const $updatedAt = row.$updatedAt;
  if (
    typeof $createdAt !== 'string' ||
    typeof $updatedAt !== 'string' ||
    $createdAt.length === 0 ||
    $updatedAt.length === 0
  ) {
    const id = row.$id ?? row.id;
    throw new Error(
      `Row missing non-empty string $createdAt/$updatedAt` +
        (id != null ? ` (row id: ${String(id)})` : '')
    );
  }
  return { $createdAt, $updatedAt };
}
