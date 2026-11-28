import { afterAll } from "bun:test";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { posix, win32 } from "node:path";

/**
 * Per-process temp root for `bun test`.
 *
 * `storageRootEnv` deliberately does not set TMPDIR: `os.tmpdir()` follows it,
 * and disposing that root while the variable still points there makes later
 * `mkdtemp` calls fail. mpv's Unix socket also has to stay under 100 bytes
 * (`apps/cli/src/infra/player/mpv-ipc-endpoint.ts` skips a candidate at
 * `>= 100`). This scratch is one short directory for the whole process.
 * Bun's runner never delivers `exit` to a preload, so the removal is an
 * `afterAll` hook. Throwing from that hook is what fails a CI run.
 *
 * Do not call `os.tmpdir()` here. Node caches the first answer, and a preload
 * that read it before assigning TMPDIR would pin every later test to the
 * real temp directory.
 */

export const POSIX_SCRATCH_PATH_LIMIT = 64;
const UNIX_SOCKET_PATH_LIMIT = 100;
const SOCKET_TAIL = "/kunai-ipc/kunai-mpv-0123456789abcdef.sock";
const SCRATCH_ATTEMPTS = 8;
export const MAX_LISTED_LEFTOVERS = 20;

/**
 * Runtimes write these under `os.tmpdir()`; they are not fixtures a test
 * created. `node-compile-cache` is Bun's compile cache while it loads test
 * modules. `.dotnet` is the .NET runtime behind `pwsh`, which the installer
 * integration tests spawn (seen on the macOS runner).
 */
const RUNTIME_SCRATCH_ENTRIES: ReadonlySet<string> = new Set(["node-compile-cache", ".dotnet"]);

/**
 * Directories production deliberately keeps under the temp root across runs.
 * `kunai-ipc` is the owner-only mpv socket directory used when
 * XDG_RUNTIME_DIR is unset (macOS, some Linux); see mpvIpcSocketDirCandidates.
 * The empty directory is expected. Anything left inside it, such as a socket
 * a test never closed, is still a leak and is reported as `kunai-ipc/<name>`.
 */
const PERSISTENT_RUNTIME_DIRECTORIES: ReadonlySet<string> = new Set(["kunai-ipc"]);

export function testScratchLeftovers(
  names: readonly string[],
  listChild: (name: string) => readonly string[] = () => [],
): readonly string[] {
  const leftovers: string[] = [];
  for (const name of names) {
    if (RUNTIME_SCRATCH_ENTRIES.has(name)) continue;
    if (!PERSISTENT_RUNTIME_DIRECTORIES.has(name)) {
      leftovers.push(name);
      continue;
    }
    for (const child of listChild(name)) leftovers.push(`${name}/${child}`);
  }
  return leftovers;
}

export type TempEnvSnapshot = {
  readonly TMPDIR: string | undefined;
  readonly TMP: string | undefined;
  readonly TEMP: string | undefined;
};

export type ScratchDirectoryIo = {
  readonly list: (directory: string) => readonly string[];
  readonly remove: (directory: string) => void;
};

export type ScratchLeakReport = {
  readonly ci: boolean;
  readonly warn: (line: string) => void;
};

export type TestScratchSession = {
  readonly directory: string;
  readonly previous: TempEnvSnapshot;
  profileCleanup: () => void;
  failure: Error | undefined;
};

type PathJoin = (...parts: string[]) => string;

function joinFor(platform: NodeJS.Platform): PathJoin {
  return platform === "win32" ? win32.join : posix.join;
}

function uniquePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const path of paths) {
    if (path.length === 0 || seen.has(path)) continue;
    seen.add(path);
    unique.push(path);
  }
  return unique;
}

export function hostTempDirectory(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string {
  if (platform === "win32") return env.TEMP || env.TMP || env.TMPDIR || "C:\\Windows\\Temp";
  return env.TMPDIR || env.TMP || env.TEMP || "/tmp";
}

export function scratchKeepsMpvSocket(scratch: string): boolean {
  return Buffer.byteLength(`${scratch}${SOCKET_TAIL}`) < UNIX_SOCKET_PATH_LIMIT;
}

export function assertScratchPath(scratch: string, platform: NodeJS.Platform): void {
  if (platform === "win32") return;
  if (scratch.length > POSIX_SCRATCH_PATH_LIMIT) {
    throw new Error(
      `POSIX test scratch is ${scratch.length} characters; the limit is ${POSIX_SCRATCH_PATH_LIMIT} (${scratch}).`,
    );
  }
}

/**
 * Deep macOS TMPDIR values (`/var/folders/…/T`, the path the socket tests
 * already pin) cannot host `kt-<pid>-<4 hex>` and still leave room for
 * `kunai-ipc/kunai-mpv-<16>.sock`. `/tmp` can. Linux `/tmp` and `/var/tmp` fit
 * as themselves.
 */
export function selectScratchParent(
  platform: NodeJS.Platform,
  name: string,
  parents: readonly string[],
): string {
  const first = parents[0];
  if (first === undefined) throw new Error("No temp directory is available for the test scratch.");
  if (platform === "win32") return first;
  const join = joinFor(platform);
  for (const parent of parents) {
    const scratch = join(parent, name);
    if (scratch.length <= POSIX_SCRATCH_PATH_LIMIT && scratchKeepsMpvSocket(scratch)) return parent;
  }
  throw new Error(
    `Test scratch ${name} does not fit under ${parents.join(", ")} within ${POSIX_SCRATCH_PATH_LIMIT} characters and the mpv socket budget.`,
  );
}

function randomScratchSuffix(): string {
  const bytes = new Uint8Array(2);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createTestScratchDirectory(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  pid: number,
  suffixes: readonly string[],
  mkdir: (path: string) => void,
  extraParents: readonly string[] = [],
): string {
  const real = hostTempDirectory(platform, env);
  const parents =
    platform === "win32"
      ? uniquePaths([real, ...extraParents])
      : uniquePaths([real, ...extraParents, "/tmp"]);
  const join = joinFor(platform);
  let occupied: Error | undefined;
  for (const suffix of suffixes) {
    if (!/^[0-9a-f]{4}$/.test(suffix)) {
      throw new Error(`Test scratch suffix must be 4 hex characters, got ${suffix}.`);
    }
    const name = `kt-${pid}-${suffix}`;
    const parent = selectScratchParent(platform, name, parents);
    const scratch = join(parent, name);
    assertScratchPath(scratch, platform);
    try {
      mkdir(scratch);
      return scratch;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
      occupied = error;
    }
  }
  throw occupied ?? new Error("Could not create the test scratch directory.");
}

export function snapshotTempEnv(env: NodeJS.ProcessEnv): TempEnvSnapshot {
  return { TMPDIR: env.TMPDIR, TMP: env.TMP, TEMP: env.TEMP };
}

export function applyTempEnv(env: NodeJS.ProcessEnv, directory: string): void {
  env.TMPDIR = directory;
  env.TMP = directory;
  env.TEMP = directory;
}

export function restoreTempEnv(env: NodeJS.ProcessEnv, previous: TempEnvSnapshot): void {
  restoreKey(env, "TMPDIR", previous.TMPDIR);
  restoreKey(env, "TMP", previous.TMP);
  restoreKey(env, "TEMP", previous.TEMP);
}

function restoreKey(
  env: NodeJS.ProcessEnv,
  key: "TMPDIR" | "TMP" | "TEMP",
  value: string | undefined,
): void {
  if (value === undefined) delete env[key];
  else env[key] = value;
}

export function leftoverMessage(names: readonly string[]): string {
  const shown = names.slice(0, MAX_LISTED_LEFTOVERS);
  const hidden = names.length - shown.length;
  const extra = hidden > 0 ? ` (+${hidden} more)` : "";
  return `Test scratch left ${names.length} entries: ${shown.join(", ")}${extra}`;
}

/**
 * List first, put the caller's TMPDIR/TMP/TEMP back, then remove the scratch.
 * Restoring first means a removal failure cannot leave `os.tmpdir()` pointing
 * at a directory we are deleting.
 */
export function disposeTestScratch(
  directory: string,
  previous: TempEnvSnapshot,
  env: NodeJS.ProcessEnv,
  io: ScratchDirectoryIo,
  report: ScratchLeakReport,
): void {
  const names = testScratchLeftovers(io.list(directory), (name) => {
    try {
      return io.list(joinFor(process.platform)(directory, name));
    } catch {
      // Not a directory (or unreadable): the entry itself is the leftover.
      return ["(not a directory)"];
    }
  });
  restoreTempEnv(env, previous);
  io.remove(directory);
  if (names.length === 0) return;
  const message = leftoverMessage(names);
  if (report.ci) throw new Error(message);
  report.warn(message);
}

export function listScratchEntries(directory: string): readonly string[] {
  try {
    return readdirSync(directory);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

export function removeScratchDirectory(directory: string): void {
  rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}

export function cleanupTestScratch(
  session: TestScratchSession,
  env: NodeJS.ProcessEnv,
  io: ScratchDirectoryIo = realScratchIo,
  warn: (line: string) => void = (line) => {
    console.warn(line);
  },
): void {
  try {
    session.profileCleanup();
  } catch (error) {
    session.failure = error instanceof Error ? error : new Error("Test scratch cleanup failed");
  }
  try {
    disposeTestScratch(session.directory, session.previous, env, io, {
      ci: env.CI === "true",
      warn,
    });
  } catch (error) {
    // Record, never throw here: Bun skips every later preload afterAll once one
    // throws, and the profile guard registered after this hook must still run.
    // finishTestScratch's hook, registered last, rethrows the failure.
    session.failure = error instanceof Error ? error : new Error("Test scratch cleanup failed");
  }
}

const realScratchIo: ScratchDirectoryIo = {
  list: listScratchEntries,
  remove: removeScratchDirectory,
};

export function beginTestScratch(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  pid: number = process.pid,
): TestScratchSession | undefined {
  const previous = snapshotTempEnv(env);
  const suffixes: string[] = [];
  for (let attempt = 0; attempt < SCRATCH_ATTEMPTS; attempt += 1) {
    suffixes.push(randomScratchSuffix());
  }
  const directory = createTestScratchDirectory(platform, env, pid, suffixes, (path) => {
    mkdirSync(path, { mode: 0o700 });
  });
  applyTempEnv(env, directory);
  const session: TestScratchSession = {
    directory,
    previous,
    profileCleanup: () => {},
    failure: undefined,
  };
  try {
    afterAll(() => {
      cleanupTestScratch(session, env);
    });
  } catch {
    restoreTempEnv(env, previous);
    removeScratchDirectory(directory);
    return undefined;
  }
  return session;
}

export function finishTestScratch(session: TestScratchSession): void {
  try {
    afterAll(() => {
      if (session.failure !== undefined) throw session.failure;
    });
  } catch {
    // beginTestScratch already restored the environment when the runner was absent.
  }
}
