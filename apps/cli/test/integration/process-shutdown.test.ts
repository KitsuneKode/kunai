import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Real-process shutdown coverage: spawn the CLI against an isolated shadow XDG
// profile, deliver a signal, and assert the conventional exit status plus a
// readable data store afterwards. Never touches the live user profile.
//
// Ink refuses to mount without a raw-mode TTY, so the CLI runs under
// `script(1)`, which allocates a pty and (via -e) propagates the child's exit
// status. The wrapper shell writes its own PID before exec-ing bun — exec
// preserves the PID — so the test can signal the CLI process directly.

const repoRoot = resolve(import.meta.dir, "../../../..");
const tempRoots: string[] = [];
const spawnedPids: number[] = [];

afterEach(() => {
  for (const pid of spawnedPids.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already exited
    }
  }
  for (const dir of tempRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createShadowProfile(): { root: string; config: string; data: string; cache: string } {
  const root = mkdtempSync(join(tmpdir(), "kunai-shutdown-shadow-"));
  tempRoots.push(root);
  const dirs = {
    root,
    config: join(root, "config"),
    data: join(root, "data"),
    cache: join(root, "cache"),
  };
  mkdirSync(join(dirs.config, "kunai"), { recursive: true });
  mkdirSync(join(dirs.data, "kunai"), { recursive: true });
  mkdirSync(join(dirs.cache, "kunai"), { recursive: true });
  writeFileSync(
    join(dirs.config, "kunai", "config.json"),
    `${JSON.stringify({ onboardingVersion: 2, downloadOnboardingDismissed: true })}\n`,
  );
  return dirs;
}

async function spawnAndSignal(
  signal: "SIGINT" | "SIGTERM" | "SIGHUP",
): Promise<{ exitCode: number; dataDbPath: string }> {
  const shadow = createShadowProfile();
  const pidFile = join(shadow.root, "cli.pid");
  const cliCommand = [
    `echo $$ > ${pidFile};`,
    "exec env",
    `XDG_CONFIG_HOME=${shadow.config}`,
    `XDG_DATA_HOME=${shadow.data}`,
    `XDG_CACHE_HOME=${shadow.cache}`,
    "bun apps/cli/src/main.ts",
  ].join(" ");
  // Capture the transcript instead of discarding it. When the CLI fails to boot
  // (which is environment-specific — it happens on CI runners but not locally)
  // the only symptom used to be `kill(): ESRCH` from the signal below, which
  // says nothing about why. The log is what turns that into a real report.
  const transcript = join(shadow.root, "cli.log");
  const child = Bun.spawn(["script", "-qec", cliCommand, transcript], {
    cwd: repoRoot,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  spawnedPids.push(child.pid);

  const readTranscript = (): string =>
    existsSync(transcript) ? readFileSync(transcript, "utf8").trim() : "<no transcript captured>";

  const dataDbPath = join(shadow.data, "kunai", "kunai-data.sqlite");
  const startupDeadline = Date.now() + 15_000;
  while (Date.now() < startupDeadline && !(existsSync(pidFile) && existsSync(dataDbPath))) {
    await Bun.sleep(100);
  }
  if (!existsSync(pidFile) || !existsSync(dataDbPath)) {
    throw new Error(
      `CLI did not reach a booted state within 15s ` +
        `(pidFile=${existsSync(pidFile)}, dataDb=${existsSync(dataDbPath)}).\n` +
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

  const exitCode = await Promise.race([child.exited, Bun.sleep(10_000).then(() => -1)]);
  return { exitCode: exitCode as number, dataDbPath };
}

describe("process shutdown", () => {
  test("SIGINT exits 130 and leaves the shadow data store readable", async () => {
    const { exitCode, dataDbPath } = await spawnAndSignal("SIGINT");
    expect(exitCode).toBe(130);

    const db = new Database(dataDbPath, { readonly: true });
    const tables = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table'")
      .all();
    db.close();
    expect(tables.length).toBeGreaterThan(0);
  }, 30_000);

  test("SIGTERM exits 143", async () => {
    const { exitCode } = await spawnAndSignal("SIGTERM");
    expect(exitCode).toBe(143);
  }, 30_000);

  test("SIGHUP exits 129", async () => {
    const { exitCode } = await spawnAndSignal("SIGHUP");
    expect(exitCode).toBe(129);
  }, 30_000);
});
