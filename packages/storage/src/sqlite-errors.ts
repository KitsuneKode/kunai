/**
 * Only SQLite's corruption result codes authorize moving a user's database.
 * Callers narrow a catch-clause value to `Error` first; anything thrown that
 * is not one, or lacks a `code` property, is not corruption evidence.
 */
export function isSqliteCorruptionError(error: Error): boolean {
  if (!("code" in error)) return false;
  // Bun exposes SQLite result codes as strings, including extended CORRUPT codes.
  return (
    error.code === "SQLITE_CORRUPT" ||
    error.code === "SQLITE_CORRUPT_VTAB" ||
    error.code === "SQLITE_CORRUPT_SEQUENCE" ||
    error.code === "SQLITE_CORRUPT_INDEX" ||
    error.code === "SQLITE_NOTADB"
  );
}
