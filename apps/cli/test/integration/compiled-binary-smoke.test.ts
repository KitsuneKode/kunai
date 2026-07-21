import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { verifyReleaseArtifactDirectory } from "../../../../scripts/verify-release-artifact-directory";
import {
  COMPILED_SMOKE_FIXTURES,
  COMPILED_SMOKE_SCENARIO_IDS,
  createCompiledSmokeProfile,
  evidenceHasPlaybackStart,
  historyRows,
  openDataDb,
  queueRows,
  resolveHostBinary,
  runCompiledSmokeScenario,
  type CompiledSmokeScenarioId,
} from "./helpers/compiled-binary-harness";

const CLI_ROOT = join(import.meta.dirname, "../..");
const BIN_DIR = join(CLI_ROOT, "dist/bin");
const GLIBC_BIN = resolveHostBinary();
const REQUIRE_BINARY = process.env.KUNAI_BINARY_SMOKE === "1";

function packageVersion(): string {
  return (JSON.parse(readFileSync(join(CLI_ROOT, "package.json"), "utf8")) as { version: string })
    .version;
}

function runBinary(args: readonly string[]) {
  return Bun.spawnSync([GLIBC_BIN, ...args], {
    cwd: CLI_ROOT,
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: process.env.HOME ?? "/tmp",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
}

const describeBinary = REQUIRE_BINARY ? describe : describe.skip;
const profiles: Array<ReturnType<typeof createCompiledSmokeProfile>> = [];

afterEach(() => {
  for (const profile of profiles.splice(0)) profile.cleanup();
});

describeBinary("compiled linux binary smoke", () => {
  test("kunai-linux-x64 exists after build:binaries", () => {
    expect(existsSync(GLIBC_BIN)).toBe(true);
  });

  test("prints kunai version (not bun runtime version)", () => {
    const result = runBinary(["--version"]);
    expect(result.exitCode).toBe(0);
    const stdout = result.stdout.toString();
    expect(stdout.trim()).toMatch(/^kunai \d+\.\d+\.\d+/);
    expect(stdout.trim()).not.toBe("1.3.14");
  });

  test("shows kunai help", () => {
    const result = runBinary(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("Kunai");
    expect(result.stdout.toString()).not.toContain("Bun is a fast JavaScript runtime");
  });

  test("production startup does not load smoke fixture without both env gates", () => {
    const result = Bun.spawnSync([GLIBC_BIN, "--version"], {
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        HOME: process.env.HOME ?? "/tmp",
        // Flag alone must not change production --version path.
        KUNAI_COMPILED_SMOKE: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString().trim()).toMatch(/^kunai \d+\.\d+\.\d+/);
  });

  test("dist/bin satisfies the exact nine-file release asset contract", async () => {
    await verifyReleaseArtifactDirectory({
      directory: BIN_DIR,
      expectedVersion: packageVersion(),
    });
  });

  test("movie persists history and records playback-start evidence", async () => {
    const profile = createCompiledSmokeProfile();
    profiles.push(profile);
    const result = await runCompiledSmokeScenario({ scenario: "movie", profile });
    expect(result.status).toBe(0);
    expect(evidenceHasPlaybackStart(result.evidence)).toBe(true);
    const db = openDataDb(result.dataDbPath);
    const rows = historyRows(db);
    db.close();
    expect(rows[0]?.title_id).toBe(COMPILED_SMOKE_FIXTURES.movie.titleId);
    expect(rows[0]?.media_kind).toBe("movie");
  });

  test("series persists season/episode identity", async () => {
    const profile = createCompiledSmokeProfile();
    profiles.push(profile);
    const result = await runCompiledSmokeScenario({ scenario: "series", profile });
    expect(result.status).toBe(0);
    expect(evidenceHasPlaybackStart(result.evidence)).toBe(true);
    const db = openDataDb(result.dataDbPath);
    const rows = historyRows(db);
    db.close();
    expect(rows[0]?.title_id).toBe(COMPILED_SMOKE_FIXTURES.series.titleId);
    expect(rows[0]?.season).toBe(COMPILED_SMOKE_FIXTURES.series.season);
    expect(rows[0]?.episode).toBe(COMPILED_SMOKE_FIXTURES.series.episode);
  });

  test("anime persists absolute episode identity", async () => {
    const profile = createCompiledSmokeProfile();
    profiles.push(profile);
    const result = await runCompiledSmokeScenario({ scenario: "anime", profile });
    expect(result.status).toBe(0);
    expect(evidenceHasPlaybackStart(result.evidence)).toBe(true);
    const db = openDataDb(result.dataDbPath);
    const rows = historyRows(db);
    db.close();
    expect(rows[0]?.title_id).toBe(COMPILED_SMOKE_FIXTURES.anime.titleId);
    expect(rows[0]?.absolute_episode).toBe(COMPILED_SMOKE_FIXTURES.anime.absoluteEpisode);
  });

  test("queue-manual acknowledges exact claimed row and leaves sibling pending", async () => {
    const profile = createCompiledSmokeProfile();
    profiles.push(profile);
    const result = await runCompiledSmokeScenario({ scenario: "queue-manual", profile });
    expect(result.status).toBe(0);
    expect(evidenceHasPlaybackStart(result.evidence)).toBe(true);
    const db = openDataDb(result.dataDbPath);
    const rows = queueRows(db);
    db.close();
    const claimed = rows.find(
      (row) => row.title_id === COMPILED_SMOKE_FIXTURES.queueManual.claimedTitleId,
    );
    const sibling = rows.find(
      (row) => row.title_id === COMPILED_SMOKE_FIXTURES.queueManual.siblingTitleId,
    );
    expect(claimed?.status).toBe("played");
    expect(sibling?.status).toBe("pending");
  });

  test("auto-next reuses persistent mpv via loadfile", async () => {
    const profile = createCompiledSmokeProfile();
    profiles.push(profile);
    const result = await runCompiledSmokeScenario({ scenario: "auto-next", profile });
    expect(result.status).toBe(0);
    expect(evidenceHasPlaybackStart(result.evidence)).toBe(true);
    const loadfiles = result.evidence.filter((row) => row.type === "loadfile");
    const fileLoaded = result.evidence.filter((row) => row.type === "file-loaded");
    expect(loadfiles.length).toBeGreaterThanOrEqual(1);
    expect(fileLoaded.length).toBeGreaterThanOrEqual(2);
    const pids = new Set(
      result.evidence.filter((row) => row.type === "spawn").map((row) => row.pid),
    );
    expect(pids.size).toBe(1);
  });

  test("failed-handoff restores exact row to pending with failure", async () => {
    const profile = createCompiledSmokeProfile();
    profiles.push(profile);
    const result = await runCompiledSmokeScenario({
      scenario: "failed-handoff",
      profile,
      mpvMode: "fail-pre-loaded",
    });
    expect(result.status).toBe(0);
    const db = openDataDb(result.dataDbPath);
    const rows = queueRows(db);
    db.close();
    const entry = rows.find(
      (row) => row.title_id === COMPILED_SMOKE_FIXTURES.failedHandoff.titleId,
    );
    expect(entry?.status).toBe("pending");
    expect(entry?.last_failure_json).toContain("mpv-launch-failed");
  });

  test("shutdown-restore recovers exact in-flight entry", async () => {
    const profile = createCompiledSmokeProfile();
    profiles.push(profile);
    const seed = await runCompiledSmokeScenario({
      scenario: "shutdown-restore",
      profile,
      phase: "seed",
      mpvMode: "hold",
    });
    expect(seed.status).toBe(0);
    expect(evidenceHasPlaybackStart(seed.evidence)).toBe(true);

    const restore = await runCompiledSmokeScenario({
      scenario: "shutdown-restore",
      profile,
      phase: "restore",
      mpvMode: "normal",
    });
    expect(restore.status).toBe(0);
    expect(
      restore.evidence.some(
        (row) =>
          row.type === "shutdown-restore-done" &&
          row.resumeTitleId === COMPILED_SMOKE_FIXTURES.shutdownRestore.titleId &&
          row.resumeAbsoluteEpisode === COMPILED_SMOKE_FIXTURES.shutdownRestore.absoluteEpisode,
      ),
    ).toBe(true);
  });

  test("return-to-shell survives EOF with shell heartbeat evidence", async () => {
    const profile = createCompiledSmokeProfile();
    profiles.push(profile);
    const result = await runCompiledSmokeScenario({ scenario: "return-to-shell", profile });
    expect(result.status).toBe(0);
    expect(evidenceHasPlaybackStart(result.evidence)).toBe(true);
    expect(result.evidence.some((row) => row.type === "shell-alive-after-eof")).toBe(true);
    expect(result.evidence.some((row) => row.type === "shell-heartbeat")).toBe(true);
  });

  test("covers every CompiledSmokeScenarioId", () => {
    const covered: CompiledSmokeScenarioId[] = [
      "movie",
      "series",
      "anime",
      "queue-manual",
      "auto-next",
      "failed-handoff",
      "shutdown-restore",
      "return-to-shell",
    ];
    expect([...COMPILED_SMOKE_SCENARIO_IDS].sort()).toEqual([...covered].sort());
  });
});
