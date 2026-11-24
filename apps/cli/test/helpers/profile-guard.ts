import { afterAll } from "bun:test";
import { lstatSync, readdirSync, type Stats } from "node:fs";
import { join } from "node:path";

import { getKunaiPaths } from "@kunai/storage";

/**
 * `bun test` runs with the developer's real home, so a test that mounts a shell or boots a service
 * without isolating itself writes the real Kunai profile. One did: BrowseShell saves a submitted
 * search query, and a multi-file run overwrote a 50-entry history with test strings.
 *
 * The guard snapshots the real config, data and cache directories (and, by name, `config.json`,
 * the mpv bridge script and both SQLite databases) when the test process starts, and fails the run
 * if anything in them differs when it ends.
 *
 * It detects lasting changes; it is NOT a write barrier. A write still lands — the guard only makes
 * the run that caused it fail, naming the path — and a write that is undone before the run ends
 * (create then delete, or a rewrite that restores size and mtime) goes unseen. Isolating a test is
 * still `applyStorageRootEnv`.
 *
 * It is read-only by construction: `readdirSync` and `lstatSync`, nothing else. A profile that does
 * not exist is recorded as absent, never created.
 *
 * Parallel workers: `bun test --parallel` loads the preload once per worker, so each worker takes
 * its own snapshot before any of its test files run. A worker that leaks always snapshotted before
 * its own write, so it always reports it; another worker whose window overlaps the write may report
 * the same path too. Either way the run fails — attribution is to the run, not the worker.
 */

export type ProfileDifference = {
  readonly kind: "added" | "changed" | "removed";
  readonly path: string;
};

/**
 * path -> signature. Files are "size:mtimeMs" (a rewrite of identical content still moves the
 * mtime, and still counts); a profile root that exists is "dir" so creating one is a difference.
 */
export type ProfileSnapshot = ReadonlyMap<string, string>;

export type ProfileTargets = {
  /** Directories walked to {@link MAX_DEPTH}. */
  readonly roots: readonly string[];
  /** Files stat'ed by name regardless of depth, so the ones that matter never fall outside the walk. */
  readonly files: readonly string[];
};

const MAX_DEPTH = 3;

/**
 * Directories the real app fills and empties on its own while it plays something. `chapters/` holds
 * ffmetadata written when playback starts and deleted when it ends; flagging it would make the guard
 * fire whenever the developer simply watched a title during a run, and a guard that cries wolf gets
 * switched off.
 */
const TRANSIENT_DIRECTORIES: ReadonlySet<string> = new Set(["chapters"]);

/**
 * What Kunai persists to, resolved from `env` as given. Call this before a test changes the
 * environment: the preload does, so `env` is the developer's real HOME/XDG/APPDATA.
 */
export function realProfileTargets(env: NodeJS.ProcessEnv = process.env): ProfileTargets {
  const paths = getKunaiPaths({ env });
  return {
    roots: [...new Set([paths.configDir, paths.dataDir, paths.cacheDir])],
    files: [
      ...new Set([paths.configPath, paths.mpvBridgePath, paths.dataDbPath, paths.cacheDbPath]),
    ],
  };
}

/** The directories Kunai persists to, resolved from `env` as given. */
export function realProfileRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  return [...realProfileTargets(env).roots];
}

function statOrUndefined(path: string): Stats | undefined {
  try {
    return lstatSync(path);
  } catch {
    return undefined; // absent, or removed between the listing and the stat
  }
}

function fileSignature(stat: Stats): string {
  return `${stat.size}:${stat.mtimeMs}`;
}

export function snapshotProfile(
  roots: readonly string[],
  files: readonly string[] = [],
): ProfileSnapshot {
  const snapshot = new Map<string, string>();
  const walk = (dir: string, depth: number): void => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      // A root that does not exist yet is an empty profile; an unreadable one cannot be compared.
      return;
    }
    for (const name of names) {
      const path = join(dir, name);
      const stat = statOrUndefined(path);
      if (!stat || stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        if (depth < MAX_DEPTH && !TRANSIENT_DIRECTORIES.has(name)) walk(path, depth + 1);
      } else {
        snapshot.set(path, fileSignature(stat));
      }
    }
  };
  for (const root of roots) {
    if (statOrUndefined(root)?.isDirectory()) snapshot.set(root, "dir");
    walk(root, 1);
  }
  for (const file of files) {
    const stat = statOrUndefined(file);
    if (stat && !stat.isDirectory() && !stat.isSymbolicLink())
      snapshot.set(file, fileSignature(stat));
  }
  return snapshot;
}

export function diffProfile(before: ProfileSnapshot, after: ProfileSnapshot): ProfileDifference[] {
  const added: ProfileDifference[] = [];
  const changed: ProfileDifference[] = [];
  const removed: ProfileDifference[] = [];
  for (const [path, signature] of after) {
    const previous = before.get(path);
    if (previous === undefined) added.push({ kind: "added", path });
    else if (previous !== signature) changed.push({ kind: "changed", path });
  }
  for (const path of before.keys()) {
    if (!after.has(path)) removed.push({ kind: "removed", path });
  }
  const byPath = (a: ProfileDifference, b: ProfileDifference) => a.path.localeCompare(b.path);
  return [...added.sort(byPath), ...changed.sort(byPath), ...removed.sort(byPath)];
}

export function describeProfileLeak(differences: readonly ProfileDifference[]): string {
  const lines = differences.map((d) => `  ${d.kind.padEnd(7)} ${d.path}`);
  return [
    "",
    "This test run changed your real Kunai profile:",
    ...lines,
    "",
    "A test that mounts a shell or boots a service must isolate itself with",
    "applyStorageRootEnv (apps/cli/test/helpers/storage-env.ts). Run the files separately and in",
    "groups to find which one wrote; a lone file can exit before its write lands.",
    "If you were using Kunai itself while the tests ran, re-run. To skip this check, set",
    "KUNAI_TEST_SKIP_PROFILE_GUARD=1.",
    "",
  ].join("\n");
}

/**
 * Called once from the test preload, before any test has changed the environment.
 *
 * The check runs in a global `afterAll`, not a `process.on("exit")` handler: Bun's test runner never
 * delivers `exit` or `beforeExit` to a preload and ignores `process.exitCode` set there, so an exit
 * hook would silently never fire. Throwing from a preload `afterAll` is what fails the run.
 */
export function installProfileGuard(env: NodeJS.ProcessEnv = process.env): void {
  if (env.KUNAI_TEST_SKIP_PROFILE_GUARD === "1") return;
  // Resolve once, now: a test that applies a sandbox later must not move what the guard watches.
  const { roots, files } = realProfileTargets({ ...env });
  const before = snapshotProfile(roots, files);
  try {
    afterAll(() => {
      const differences = diffProfile(before, snapshotProfile(roots, files));
      if (differences.length > 0) throw new Error(describeProfileLeak(differences));
    });
  } catch {
    // The preload is also loaded by plain `bun` children (the privacy preload
    // test spawns one). Outside the runner there is no run to fail.
  }
}
