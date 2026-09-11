import { chmodSync, mkdirSync, rmdirSync } from "node:fs";
import { join } from "node:path";

/** Own the complete load/prompt/commit session, not just individual writes. */
export function acquireNodeSession(root: string): () => void {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  chmodSync(root, 0o700);
  const lock = join(root, "session.lock");
  try {
    mkdirSync(lock, { mode: 0o700 });
  } catch {
    throw new Error("Mobile session is already active or requires lock recovery");
  }
  let released = false;
  const release = () => {
    if (released) return;
    rmdirSync(lock);
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
