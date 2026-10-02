import { chmodSync, mkdirSync, rmdirSync } from "node:fs";
import { join } from "node:path";

/** Own the complete load/prompt/commit session, not just individual writes. */
export function acquireNodeSession(root: string): () => void {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  chmodSync(root, 0o700);
  const lock = join(root, "session.lock");
  try {
    mkdirSync(lock, { mode: 0o700 });
  } catch (error) {
    const rawCode = error instanceof Error && "code" in error ? error.code : undefined;
    const code = rawCode === undefined ? undefined : String(rawCode);
    if (code === "EEXIST") {
      throw new Error(
        `Mobile session is already active; remove ${lock} only if no session is running`,
      );
    }
    throw new Error(`Mobile session lock failed${code === undefined ? "" : ` (${code})`}`);
  }
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try {
      rmdirSync(lock);
    } catch {
      // A removed or occupied lock directory is operator-owned; never mask it.
    }
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
