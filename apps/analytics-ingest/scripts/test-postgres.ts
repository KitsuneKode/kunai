/**
 * One command for the Postgres-backed analytics tests: bring up the throwaway
 * database, migrate it, run the suites that need it, tear it down.
 *
 * Without this the same tests silently skip, which reads as "passing" — the
 * failure mode this whole subsystem is meant to avoid. `--keep` leaves the
 * containers running for iteration.
 *
 * Requires Docker. Set ANALYTICS_TEST_DATABASE_URL to run against an existing
 * scratch database instead and skip container management entirely — never a
 * database holding real aggregates, because these suites write and prune.
 */

import { spawn } from "node:child_process";
import { join } from "node:path";

const appDir = join(import.meta.dir, "..");
const keep = process.argv.includes("--keep");

/**
 * Matches docker-compose.yml. Non-default ports so nothing collides.
 *
 * A literal loopback address rather than a `*.localtest.me` hostname: that
 * convention needs public DNS, so it fails offline and behind split-horizon
 * resolvers. `127.0.0.1` needs no resolution anywhere, on any platform.
 */
const LOCAL_DATABASE_URL = "postgres://kunai:kunai@127.0.0.1:55432/kunai_analytics";
const LOCAL_FETCH_ENDPOINT = "http://127.0.0.1:54444/sql";

const external = process.env.ANALYTICS_TEST_DATABASE_URL?.trim();

function run(command: string, args: string[], env: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: appDir,
      stdio: "inherit",
      env: { ...process.env, ...env },
    });
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(127));
  });
}

async function main(): Promise<number> {
  // `migrate` reads DATABASE_URL; the suites read ANALYTICS_TEST_DATABASE_URL.
  // Both are set to the same target here so the schema and the tests cannot
  // land in different databases.
  const env = external
    ? { DATABASE_URL: external, ANALYTICS_TEST_DATABASE_URL: external }
    : {
        DATABASE_URL: LOCAL_DATABASE_URL,
        ANALYTICS_TEST_DATABASE_URL: LOCAL_DATABASE_URL,
        NEON_FETCH_ENDPOINT: LOCAL_FETCH_ENDPOINT,
      };

  if (!external) {
    console.log("→ starting throwaway postgres + neon http proxy");
    const up = await run("docker", ["compose", "up", "-d", "--wait"]);
    if (up !== 0) {
      console.error(
        up === 127
          ? "docker is required for test:pg — install it, or set ANALYTICS_TEST_DATABASE_URL to a scratch database"
          : "docker compose failed to start",
      );
      return up;
    }
  } else {
    console.log("→ using DATABASE_URL from the environment");
  }

  try {
    console.log("→ applying schema");
    const migrated = await run("bun", ["run", "scripts/migrate.ts"], env);
    if (migrated !== 0) return migrated;

    console.log("→ running postgres-backed suites");
    return await run(
      "bun",
      ["test", "test/postgres-store.test.ts", "test/postgres-ingest-lifecycle.test.ts"],
      env,
    );
  } finally {
    if (!external && !keep) {
      console.log("→ tearing down");
      await run("docker", ["compose", "down", "-v"]);
    }
  }
}

process.exit(await main());
