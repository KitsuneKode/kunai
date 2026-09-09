/** Only SQLite's corruption result codes authorize moving a user's database. */
export function isSqliteCorruptionError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  // Bun exposes SQLite result codes as strings, including extended CORRUPT codes.
  return (
    error.code === "SQLITE_CORRUPT" ||
    error.code === "SQLITE_CORRUPT_VTAB" ||
    error.code === "SQLITE_CORRUPT_SEQUENCE" ||
    error.code === "SQLITE_CORRUPT_INDEX" ||
    error.code === "SQLITE_NOTADB"
  );
}
