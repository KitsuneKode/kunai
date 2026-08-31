import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";

import { getKunaiPaths } from "@kunai/storage";

import { storageRootEnv } from "../helpers/storage-env";
import { validateAndroidHandoffSmoke } from "./android-terminal-handoff-guard";

const realHome = process.env.HOME ?? homedir();
const storageRoot = mkdtempSync(join(tmpdir(), "kunai-live-android-handoff-"));
const smokeEnv = {
  ...process.env,
  ...storageRootEnv(storageRoot),
  KUNAI_ANDROID_SMOKE_ROOT: storageRoot,
};

process.on("exit", () => {
  rmSync(storageRoot, { force: true, recursive: true });
});

const guard = validateAndroidHandoffSmoke({
  env: smokeEnv,
  realHome,
  fileExists: existsSync,
});
if (!guard.ok) {
  console.error(
    JSON.stringify({ ok: false, skipped: true, reason: guard.reason, error: guard.message }),
  );
  process.exit(1);
  throw new Error("unreachable after process.exit");
}
const { binaryPath, player, url } = guard;

const paths = getKunaiPaths({ platform: "linux", env: smokeEnv, homeDir: storageRoot });
mkdirSync(paths.configDir, { recursive: true });
mkdirSync(paths.dataDir, { recursive: true });
mkdirSync(paths.cacheDir, { recursive: true });

const binaryEnv = {
  ...smokeEnv,
  KUNAI_COMPILED_SMOKE: "1",
  KUNAI_COMPILED_SMOKE_FIXTURE: import.meta.path,
  KUNAI_COMPILED_SMOKE_SCENARIO: "android-handoff",
  KUNAI_COMPILED_SMOKE_EVIDENCE: join(storageRoot, "compiled-evidence.jsonl"),
  KUNAI_ANDROID_HANDOFF_URL: url,
  NO_COLOR: "1",
  TERM: process.env.TERM ?? "xterm-256color",
};

function runProbe(args: readonly string[]): ReturnType<typeof Bun.spawnSync> {
  return Bun.spawnSync([binaryPath, ...args], {
    env: binaryEnv,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
}

function readEvidence(path: string): readonly Record<string, unknown>[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function probeSqliteWal(): {
  readonly pathInsideProfile: boolean;
  readonly journalMode: string | null;
  readonly reopenedValue: string | null;
} {
  const databasePath = join(paths.dataDir, "android-handoff-smoke.sqlite");
  const database = new Database(databasePath, { create: true });
  const journal = database.query("PRAGMA journal_mode = WAL").get() as {
    journal_mode?: string;
  } | null;
  database.run("CREATE TABLE smoke_probe (value TEXT NOT NULL)");
  database.run("INSERT INTO smoke_probe (value) VALUES (?)", ["reopened"]);
  database.close();

  const reopened = new Database(databasePath);
  const row = reopened.query("SELECT value FROM smoke_probe LIMIT 1").get() as {
    value?: string;
  } | null;
  reopened.close();
  return {
    pathInsideProfile: databasePath.startsWith(storageRoot),
    journalMode: journal?.journal_mode ?? null,
    reopenedValue: row?.value ?? null,
  };
}

try {
  const versionProbe = runProbe(["--version"]);
  const helpProbe = runProbe(["--help"]);
  const scenario = Bun.spawn([binaryPath, "--minimal", "--player", player], {
    env: binaryEnv,
    stdin: "inherit",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [scenarioStdout, scenarioStderr, scenarioExitCode] = await Promise.all([
    new Response(scenario.stdout).text(),
    new Response(scenario.stderr).text(),
    scenario.exited,
  ]);
  const evidence = readEvidence(binaryEnv.KUNAI_COMPILED_SMOKE_EVIDENCE);
  const accepted = evidence.find((row) => row.type === "android-handoff-accepted");
  const sqlite = probeSqliteWal();
  const version = versionProbe.stdout?.toString().trim() ?? "";
  const help = helpProbe.stdout?.toString() ?? "";
  const ok =
    versionProbe.exitCode === 0 &&
    /^kunai \d+\.\d+\.\d+/.test(version) &&
    helpProbe.exitCode === 0 &&
    help.includes("Kunai") &&
    scenarioExitCode === 0 &&
    accepted !== undefined &&
    sqlite.journalMode?.toLowerCase() === "wal" &&
    sqlite.reopenedValue === "reopened";

  console.log(
    JSON.stringify({
      ok,
      skipped: false,
      binary: basename(binaryPath),
      version,
      runtime: `bun-${Bun.version}`,
      platform: "android-termux",
      tty: {
        stdin: process.stdin.isTTY === true,
        stdout: process.stdout.isTTY === true,
      },
      isolatedProfile: true,
      streamHost: new URL(url).host,
      player,
      launcher: typeof accepted?.launcher === "string" ? accepted.launcher : null,
      accepted: accepted !== undefined,
      compiledEntrypoint: {
        versionExitCode: versionProbe.exitCode,
        helpExitCode: helpProbe.exitCode,
        scenarioExitCode,
        scenarioStdoutBytes: scenarioStdout.length,
        scenarioStderrBytes: scenarioStderr.length,
      },
      sqlite: {
        ...sqlite,
        appDataDatabaseCreated: existsSync(paths.dataDbPath),
        appCacheDatabaseCreated: existsSync(paths.cacheDbPath),
      },
    }),
  );
  if (!ok) process.exitCode = 1;
} catch (error) {
  console.error(
    JSON.stringify({
      ok: false,
      skipped: false,
      binary: basename(binaryPath),
      isolatedProfile: true,
      streamHost: new URL(url).host,
      player,
      error: error instanceof Error ? error.message : "Android handoff smoke failed",
    }),
  );
  process.exitCode = 1;
}
