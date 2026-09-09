import { expect, test } from "bun:test";

import { isSqliteCorruptionError } from "../src/sqlite-errors";

test.each([
  "SQLITE_CORRUPT",
  "SQLITE_CORRUPT_VTAB",
  "SQLITE_CORRUPT_SEQUENCE",
  "SQLITE_CORRUPT_INDEX",
  "SQLITE_NOTADB",
])("recognizes %s as corruption", (code) => {
  expect(isSqliteCorruptionError({ code })).toBe(true);
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
  expect(isSqliteCorruptionError({ code, message: "database is corrupt" })).toBe(false);
});

test("unknown failures cannot authorize quarantine", () => {
  for (const error of [
    null,
    undefined,
    11,
    "SQLITE_CORRUPT",
    new Error("database is corrupt"),
    { errno: 11 },
  ]) {
    expect(isSqliteCorruptionError(error)).toBe(false);
  }
});
