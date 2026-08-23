import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { getKunaiPaths, type KunaiPaths, type StoragePlatform } from "@kunai/storage";

import { describePosixOnly as describe } from "../helpers/platform-gates";
import { buildPtyCommand } from "../helpers/pty-command";
import { storageRootEnv } from "../helpers/storage-env";
import { removeTempDir } from "../support/remove-temp-dir";

// Real-process shutdown coverage: spawn the CLI against an isolated shadow
// profile, deliver a signal, and assert the conventional exit status plus a
// readable data store afterwards. Never touches the live user profile.
//
// Ink refuses to mount without a raw-mode TTY, so the CLI runs under a PTY
// wrapper (`script` on Linux, `expect` on macOS — see buildPtyCommand) that
// propagates shell-style signal exit statuses (128+sig). The wrapper shell
// writes its own PID before exec-ing bun — exec preserves the PID — so the
// test can signal the CLI process directly.
//
// Isolation must use storageRootEnv (HOME + XDG), not XDG alone: darwin
// getKunaiPaths ignores XDG and writes under $HOME/Library/....

const repoRoot = resolve(import.meta.dir, "../../../..");
const tempRoots: string[] = [];
const spawnedPids: number[] = [];
const startupTimeoutMs = 45_000;
const exitTimeoutMs = 10_000;
// Must exceed every bounded wait in spawnAndSignal. In particular, a slow
// macOS cold boot is allowed the full startup deadline before the helper can
// either signal the CLI or report its transcript.
const testTimeoutMs = startupTimeoutMs + 1_500 + exitTimeoutMs + 5_000;

afterEach(() => {
  for (const pid of spawnedPids.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already exited
    }
  }
  for (const dir of tempRoots.splice(0)) {
    removeTempDir(dir);
  }
});

function hostStoragePlatform(): StoragePlatform {
  return process.platform === "darwin" ? "darwin" : "linux";
}

function createShadowProfile(): {
  readonly root: string;
  readonly env: Record<string, string>;
  readonly paths: KunaiPaths;
} {
  const root = mkdtempSync(join(tmpdir(), "kunai-shutdown-shadow-"));
  tempRoots.push(root);
  const env = storageRootEnv(root);
  const paths = getKunaiPaths({
    platform: hostStoragePlatform(),
    homeDir: root,
    env,
  });
  mkdirSync(paths.configDir, { recursive: true });
  mkdirSync(paths.dataDir, { recursive: true });
  mkdirSync(paths.cacheDir, { recursive: true });
  writeFileSync(
    paths.configPath,
    `${JSON.stringify({ onboardingVersion: 2, downloadOnboardingDismissed: true })}\n`,
  );
  return { root, env, paths };
}

function shellEnvAssignments(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(" ");
}

async function spawnAndSignal(
  signal: "SIGINT" | "SIGTERM" | "SIGHUP",
): Promise<{ exitCode: number; dataDbPath: string }> {
  const shadow = createShadowProfile();
  const pidFile = join(shadow.root, "cli.pid");
  const cliCommand = [
    `echo $$ > ${JSON.stringify(pidFile)};`,
    "exec env",
    shellEnvAssignments(shadow.env),
    "bun apps/cli/src/main.ts",
  ].join(" ");
  // Capture the transcript instead of discarding it. When the CLI fails to boot
  // (which is environment-specific — it happens on CI runners but not locally)
  // the only symptom used to be `kill(): ESRCH` from the signal below, which
  // says nothing about why. The log is what turns that into a real report.
  const transcript = join(shadow.root, "cli.log");
  const child = Bun.spawn(buildPtyCommand(cliCommand, transcript), {
    cwd: repoRoot,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  spawnedPids.push(child.pid);

  const readTranscript = (): string =>
    existsSync(transcript) ? readFileSync(transcript, "utf8").trim() : "<no transcript captured>";

  const dataDbPath = shadow.paths.dataDbPath;
  // A cold CLI boot on a loaded CI runner is slow, and macOS runners are the
  // slowest of the three. This is a deadline, not a sleep: a fast machine still
  // proceeds the moment both files appear, so raising it costs nothing when
  // boot is quick and only buys headroom when it is not.
  const startupDeadline = Date.now() + startupTimeoutMs;
  while (Date.now() < startupDeadline && !(existsSync(pidFile) && existsSync(dataDbPath))) {
    await Bun.sleep(100);
  }
  if (!existsSync(pidFile) || !existsSync(dataDbPath)) {
    throw new Error(
      `CLI did not reach a booted state within ${startupTimeoutMs}ms ` +
        `(pidFile=${existsSync(pidFile)}, dataDb=${existsSync(dataDbPath)}, ` +
        `dataDbPath=${dataDbPath}).\n` +
        `--- transcript ---\n${readTranscript()}`,
    );
  }

  const cliPid = Number.parseInt(readFileSync(pidFile, "utf8").trim(), 10);
  expect(Number.isInteger(cliPid)).toBe(true);
  spawnedPids.push(cliPid);

  // Poll for liveness rather than sleeping a fixed 1.5s: a loaded CI runner can
  // take longer to mount, and a fixed wait either flakes or wastes time. If the
  // process is gone, report the transcript instead of an opaque ESRCH.
  const readyDeadline = Date.now() + 10_000;
  while (Date.now() < readyDeadline) {
    try {
      process.kill(cliPid, 0);
      break;
    } catch {
      throw new Error(
        `CLI process ${cliPid} exited before it could be signalled.\n` +
          `--- transcript ---\n${readTranscript()}`,
      );
    }
  }
  // Signal handlers are registered during mount; give that a brief beat once we
  // know the process is actually alive.
  await Bun.sleep(1_500);
  try {
    process.kill(cliPid, signal);
  } catch (error) {
    throw new Error(
      `failed to deliver ${signal} to CLI process ${cliPid}: ${(error as Error).message}\n` +
        `--- transcript ---\n${readTranscript()}`,
      { cause: error },
    );
  }

  const exitCode = await Promise.race([child.exited, Bun.sleep(exitTimeoutMs).then(() => -1)]);
  return { exitCode: exitCode as number, dataDbPath };
}

describe("process shutdown", () => {
  test(
    "SIGINT exits 130 and leaves the shadow data store readable",
    async () => {
      const { exitCode, dataDbPath } = await spawnAndSignal("SIGINT");
      expect(exitCode).toBe(130);

      const db = new Database(dataDbPath, { readonly: true });
      const tables = db
        .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table'")
        .all();
      db.close();
      expect(tables.length).toBeGreaterThan(0);
    },
    testTimeoutMs,
  );

  test(
    "SIGTERM exits 143",
    async () => {
      const { exitCode } = await spawnAndSignal("SIGTERM");
      expect(exitCode).toBe(143);
    },
    testTimeoutMs,
  );

  test(
    "SIGHUP exits 129",
    async () => {
      const { exitCode } = await spawnAndSignal("SIGHUP");
      expect(exitCode).toBe(129);
    },
    testTimeoutMs,
  );
});
