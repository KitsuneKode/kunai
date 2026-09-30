import { expect, test } from "bun:test";

import { isSqliteCorruptionError } from "../src/sqlite-errors";

function errorWithCode(code: string): Error {
  return Object.assign(new Error("sqlite failure"), { code });
}

test.each([
  "SQLITE_CORRUPT",
  "SQLITE_CORRUPT_VTAB",
  "SQLITE_CORRUPT_SEQUENCE",
  "SQLITE_CORRUPT_INDEX",
  "SQLITE_NOTADB",
])("recognizes %s as corruption", (code) => {
  expect(isSqliteCorruptionError(errorWithCode(code))).toBe(true);
});

test.each([
  "SQLITE_BUSY",
  "SQLITE_LOCKED",
  "SQLITE_READONLY",
  "SQLITE_PERM",
  "SQLITE_IOERR",
  "SQLITE_CANTOPEN",
  "SQLITE_ERROR",
  "SQLITE_CORRUPT_UNKNOWN",
  "EACCES",
])("preserves files on %s", (code) => {
  expect(isSqliteCorruptionError(errorWithCode(code))).toBe(false);
});

test("errors without a recognized corruption code cannot authorize quarantine", () => {
  expect(isSqliteCorruptionError(new Error("database is corrupt"))).toBe(false);
  expect(isSqliteCorruptionError(Object.assign(new Error("io"), { errno: 11 }))).toBe(false);
});
