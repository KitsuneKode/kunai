import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Applies sql/*.sql in filename order. Idempotent: every statement is IF NOT EXISTS. */
import { neon } from "@neondatabase/serverless";

// Side-effecting: honours NEON_FETCH_ENDPOINT so the schema lands in the same
// database the tests query. Must precede the client below.
import "../src/neon-fetch-endpoint";
import { splitSqlStatements } from "../src/sql-statements";

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const sql = neon(connectionString);
const sqlDir = join(import.meta.dir, "..", "sql");

for (const file of readdirSync(sqlDir)
  .filter((name) => name.endsWith(".sql"))
  .sort()) {
  const statements = splitSqlStatements(readFileSync(join(sqlDir, file), "utf8"));
  for (const statement of statements) {
    await sql.query(statement);
  }
  console.log(`applied ${file} (${statements.length} statements)`);
}
