import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { splitSqlStatements } from "../src/sql-statements";

describe("splitSqlStatements", () => {
  test("keeps a statement preceded by a comment block", () => {
    // The regression this guards: filtering whole chunks that start with "--"
    // discards the statement along with its comment.
    const statements = splitSqlStatements(`
-- explaining the table
create table a (x int);
`);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain("create table a");
    expect(statements[0]).not.toContain("--");
  });

  test("drops comment-only chunks and trailing whitespace", () => {
    expect(splitSqlStatements("-- just a note\n")).toEqual([]);
    expect(splitSqlStatements("   \n\n  ")).toEqual([]);
  });

  test("a semicolon inside a comment does not split the statement", () => {
    // The second regression this guards: splitting on ";" before stripping
    // comments cuts a statement in half wherever prose contains a semicolon.
    const statements = splitSqlStatements(`
create table c (
  -- ships empty; nothing writes to it yet
  z int
);
`);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain("create table c");
    expect(statements[0]).toContain("z int");
  });

  test("keeps an inline comment inside a statement out of the SQL", () => {
    const [statement] = splitSqlStatements(`
create table b (
  -- a column note
  y int
);
`);
    expect(statement).toContain("y int");
    expect(statement).not.toContain("a column note");
  });

  test("the real migration yields every table and index", () => {
    const body = readFileSync(join(import.meta.dir, "..", "sql", "001_init.sql"), "utf8");
    const statements = splitSqlStatements(body);
    const joined = statements.join("\n");

    expect(statements).toHaveLength(4);
    for (const object of ["ping_day", "ping_day_day_idx", "install_lifetime", "daily_rollup"]) {
      expect(joined).toContain(object);
    }
    // Nothing may reach the driver as a comment-only or empty statement.
    for (const statement of statements) {
      expect(statement.length).toBeGreaterThan(0);
      expect(statement.startsWith("--")).toBe(false);
    }
  });
});
