import { afterAll } from "bun:test";
import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { getKunaiPaths } from "@kunai/storage";

/**
 * `bun test` runs with the developer's real home, so a test that mounts a shell or boots a service
 * without isolating itself writes the real Kunai profile. One did: BrowseShell saves a submitted
 * search query, and a multi-file run overwrote a 50-entry history with test strings.
 *
 * The guard snapshots the real config, data and cache directories when the test process starts and
 * fails the run if anything in them differs when it exits. It reports; it cannot undo a write.
 * Isolating a test is still `applyStorageRootEnv`.
 */

export type ProfileDifference = {
  readonly kind: "added" | "changed" | "removed";
  readonly path: string;
};

/** path -> "size:mtimeMs". A rewrite of identical content still moves the mtime, and still counts. */
export type ProfileSnapshot = ReadonlyMap<string, string>;

const MAX_DEPTH = 3;

/**
 * Directories the real app fills and empties on its own while it plays something. `chapters/` holds
 * ffmetadata written when playback starts and deleted when it ends; flagging it would make the guard
 * fire whenever the developer simply watched a title during a run, and a guard that cries wolf gets
 * switched off.
 */
const TRANSIENT_DIRECTORIES: ReadonlySet<string> = new Set(["chapters"]);

/** The directories Kunai persists to, resolved from `env` as given (call this before a test changes it). */
export function realProfileRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  const paths = getKunaiPaths({ env });
  return [...new Set([paths.configDir, paths.dataDir, paths.cacheDir])];
}

export function snapshotProfile(roots: readonly string[]): ProfileSnapshot {
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
      let stat: ReturnType<typeof lstatSync>;
      try {
        stat = lstatSync(path);
      } catch {
        continue; // removed between the listing and the stat
      }
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        if (depth < MAX_DEPTH && !TRANSIENT_DIRECTORIES.has(name)) walk(path, depth + 1);
      } else {
        snapshot.set(path, `${stat.size}:${stat.mtimeMs}`);
      }
    }
  };
  for (const root of roots) walk(root, 1);
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
  const roots = realProfileRoots(env);
  const before = snapshotProfile(roots);
  try {
    afterAll(() => {
      const differences = diffProfile(before, snapshotProfile(roots));
      if (differences.length > 0) throw new Error(describeProfileLeak(differences));
    });
  } catch {
    // The preload is also loaded by plain `bun` children (the privacy preload
    // test spawns one). Outside the runner there is no run to fail.
  }
}
