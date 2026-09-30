import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ACTIVE_SESSION = "Mobile session is already active or requires lock recovery";

export type NodeSessionOptions = {
  readonly isProcessAlive?: (pid: number) => boolean;
};

function defaultIsProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    return code === "EPERM";
  }
}

function readLockPid(pidPath: string): number | undefined {
  try {
    const pid = Number(readFileSync(pidPath, "utf8").trim());
    return Number.isInteger(pid) ? pid : undefined;
  } catch {
    return undefined;
  }
}

/** Own the complete load/prompt/commit session, not just individual writes. */
export function acquireNodeSession(root: string, options: NodeSessionOptions = {}): () => void {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  chmodSync(root, 0o700);
  const lock = join(root, "session.lock");
  const pidPath = join(lock, "pid");
  const isAlive = options.isProcessAlive ?? defaultIsProcessAlive;

  const claim = () => {
    mkdirSync(lock, { mode: 0o700 });
    writeFileSync(pidPath, `${process.pid}\n`, { mode: 0o600 });
  };

  try {
    claim();
  } catch {
    const pid = readLockPid(pidPath);
    if (pid !== undefined && isAlive(pid)) throw new Error(ACTIVE_SESSION);
    rmSync(lock, { recursive: true, force: true });
    try {
      claim();
    } catch {
      throw new Error(ACTIVE_SESSION);
    }
  }

  let released = false;
  const release = () => {
    if (released) return;
    rmSync(lock, { recursive: true, force: true });
    released = true;
    process.off("exit", onExit);
  };
  const onExit = () => {
    try {
      release();
    } catch {
      // Retain an uncertain lock for operator recovery rather than stealing ownership.
    }
  };
  process.once("exit", onExit);
  return release;
}
