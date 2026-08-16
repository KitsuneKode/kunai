/**
 * Split a migration file into executable statements.
 *
 * The HTTP driver takes one statement per call, so the file has to be split on
 * `;`. Two things make the naive version wrong, and both bit during
 * development:
 *
 * 1. Splitting first and then discarding chunks that start with `--` throws
 *    away the statement along with its leading comment block. Every readable
 *    `create table` has one, so the migration silently creates almost nothing.
 * 2. Splitting first is unsafe regardless, because prose comments contain
 *    semicolons. One `-- ...opens one; the payload...` cut a `create table`
 *    in half.
 *
 * So: strip comment lines first, split second.
 *
 * Known limitation: a `;` inside a string literal would still split wrongly.
 * No migration here contains one, and a migration that needs one should use a
 * real migration tool rather than this 20-line helper.
 */
export function splitSqlStatements(body: string): string[] {
  const withoutComments = body
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");

  return withoutComments
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}
