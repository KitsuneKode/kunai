import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  COMPILED_SMOKE_FIXTURES,
  COMPILED_SMOKE_SCENARIO_IDS,
  type CompiledSmokeScenarioId,
} from "@/app/compiled-smoke/scenarios";

const CLI_ROOT = resolve(import.meta.dirname, "../../..");
const REPO_ROOT = resolve(CLI_ROOT, "../..");
const FIXTURE_PROVIDER = resolve(CLI_ROOT, "src/app/compiled-smoke/fixture-provider.ts");
const FAKE_MPV_BIN = resolve(CLI_ROOT, "test/integration/helpers/fake-mpv-bin.ts");
const GLIBC_BIN = resolve(CLI_ROOT, "dist/bin/kunai-linux-x64");

export type CompiledSmokeRunResult = {
  readonly status: number | null;
  readonly evidencePath: string;
  readonly evidence: readonly Record<string, unknown>[];
  readonly dataDbPath: string;
  readonly profileRoot: string;
  readonly stdout: string;
  readonly stderr: string;
};

export function resolveHostBinary(): string {
  return GLIBC_BIN;
}

export function createCompiledSmokeProfile(): {
  readonly root: string;
  readonly home: string;
  readonly binDir: string;
  readonly shimDir: string;
  readonly configDir: string;
  readonly dataDir: string;
  readonly cacheDir: string;
  readonly evidencePath: string;
  cleanup: () => void;
} {
  const root = mkdtempSync(join(tmpdir(), "kunai-compiled-smoke-"));
  const home = join(root, "home");
  const binDir = join(root, "bin");
  const shimDir = join(root, "shim");
  const configDir = join(home, ".config");
  const dataDir = join(home, ".local", "share");
  const cacheDir = join(home, ".cache");
  mkdirSync(join(configDir, "kunai"), { recursive: true });
  mkdirSync(join(dataDir, "kunai"), { recursive: true });
  mkdirSync(join(cacheDir, "kunai"), { recursive: true });
  mkdirSync(binDir, { recursive: true });
  mkdirSync(shimDir, { recursive: true });
  writeFileSync(
    join(configDir, "kunai", "config.json"),
    `${JSON.stringify({
      onboardingVersion: 2,
      downloadOnboardingDismissed: true,
      provider: "videasy",
      animeProvider: "allanime",
    })}\n`,
  );
  const evidencePath = join(root, "evidence.jsonl");
  const bunBin = Bun.which("bun") ?? "bun";
  writeFileSync(
    join(shimDir, "mpv"),
    `#!/bin/sh
exec ${JSON.stringify(bunBin)} ${JSON.stringify(FAKE_MPV_BIN)} "$@"
`,
    { mode: 0o755 },
  );
  // Warm the fake-mpv script so the first IPC spawn is not racing Bun compile.
  Bun.spawnSync([bunBin, FAKE_MPV_BIN, "--version"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  // Prefer the host binary under test when present.
  if (existsSync(GLIBC_BIN)) {
    writeFileSync(
      join(binDir, "kunai"),
      `#!/bin/sh
exec ${JSON.stringify(GLIBC_BIN)} "$@"
`,
      { mode: 0o755 },
    );
  }
  return {
    root,
    home,
    binDir,
    shimDir,
    configDir,
    dataDir,
    cacheDir,
    evidencePath,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function readEvidence(path: string): Record<string, unknown>[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

export async function runCompiledSmokeScenario(input: {
  readonly scenario: CompiledSmokeScenarioId;
  readonly profile: ReturnType<typeof createCompiledSmokeProfile>;
  readonly phase?: "seed" | "restore";
  readonly mpvMode?: "normal" | "fail-pre-loaded" | "hold";
  readonly binary?: string;
}): Promise<CompiledSmokeRunResult> {
  const binary = input.binary ?? GLIBC_BIN;
  if (!existsSync(binary)) {
    throw new Error(`Compiled binary missing: ${binary}. Run bun run build:binary:host first.`);
  }
  if (!existsSync(FIXTURE_PROVIDER)) {
    throw new Error(`Smoke fixture missing: ${FIXTURE_PROVIDER}`);
  }

  const env: Record<string, string | undefined> = {
    ...process.env,
    HOME: input.profile.home,
    PATH: [input.profile.binDir, input.profile.shimDir, "/usr/bin", "/bin"].join(":"),
    XDG_CONFIG_HOME: input.profile.configDir,
    XDG_DATA_HOME: input.profile.dataDir,
    XDG_CACHE_HOME: input.profile.cacheDir,
    KUNAI_COMPILED_SMOKE: "1",
    KUNAI_COMPILED_SMOKE_FIXTURE: FIXTURE_PROVIDER,
    KUNAI_COMPILED_SMOKE_SCENARIO: input.scenario,
    KUNAI_COMPILED_SMOKE_EVIDENCE: input.profile.evidencePath,
    KUNAI_FAKE_MPV_EVIDENCE: input.profile.evidencePath,
    KUNAI_FAKE_MPV_MODE: input.mpvMode ?? "normal",
    // Avoid interactive setup / network noise.
    NO_COLOR: "1",
    TERM: "xterm-256color",
  };
  if (input.phase) {
    env.KUNAI_COMPILED_SMOKE_PHASE = input.phase;
  }

  const proc = Bun.spawn([binary, "--minimal"], {
    cwd: REPO_ROOT,
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, status] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return {
    status,
    evidencePath: input.profile.evidencePath,
    evidence: readEvidence(input.profile.evidencePath),
    dataDbPath: join(input.profile.dataDir, "kunai", "kunai-data.sqlite"),
    profileRoot: input.profile.root,
    stdout,
    stderr,
  };
}

export function evidenceHasPlaybackStart(evidence: readonly Record<string, unknown>[]): boolean {
  return evidence.some((row) => {
    if (row.type === "file-loaded") return true;
    if (row.type === "playback-event" && row.event === "playback-started") return true;
    if (row.type === "playback-event" && row.event === "player-ready") return true;
    return false;
  });
}

export function openDataDb(path: string): Database {
  return new Database(path, { readonly: true });
}

export function historyRows(db: Database): Array<{
  title_id: string;
  media_kind: string;
  season: number | null;
  episode: number | null;
  absolute_episode: number | null;
}> {
  return db
    .query(
      `SELECT title_id, media_kind, season, episode, absolute_episode
       FROM history_progress
       ORDER BY updated_at DESC`,
    )
    .all() as Array<{
    title_id: string;
    media_kind: string;
    season: number | null;
    episode: number | null;
    absolute_episode: number | null;
  }>;
}

export function queueRows(db: Database): Array<{
  id: string;
  title_id: string;
  absolute_episode: number | null;
  status: string;
  last_failure_json: string | null;
}> {
  return db
    .query(
      `SELECT id, title_id, absolute_episode, status, last_failure_json
       FROM playlist_queue
       ORDER BY queue_position ASC, added_at ASC`,
    )
    .all() as Array<{
    id: string;
    title_id: string;
    absolute_episode: number | null;
    status: string;
    last_failure_json: string | null;
  }>;
}

export { COMPILED_SMOKE_FIXTURES, COMPILED_SMOKE_SCENARIO_IDS };
export type { CompiledSmokeScenarioId };
