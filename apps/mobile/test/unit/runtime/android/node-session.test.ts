import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { acquireNodeSession } from "../../../../src/runtime/android/node-session";

/** A pid that is guaranteed dead — the child exited before spawnSync returned. */
function deadPid(): number {
  return spawnSync("true").pid ?? -1;
}

test("a competing session cannot release or enter the owner's state transaction", () => {
  const root = mkdtempSync(join(tmpdir(), "kunai-mobile-session-"));
  try {
    const release = acquireNodeSession(root);
    expect(() => acquireNodeSession(root)).toThrow("session");
    release();
    const releaseNext = acquireNodeSession(root);
    release();
    expect(() => acquireNodeSession(root)).toThrow("session");
    releaseNext();
    acquireNodeSession(root)();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a crash remnant — lock dir with a dead owner — is reclaimed, not wedged", () => {
  const root = mkdtempSync(join(tmpdir(), "kunai-mobile-session-"));
  try {
    // Simulate a SIGKILLed/ANR'd session: lock dir + owner record, pid dead.
    const lock = join(root, "session.lock");
    mkdirSync(lock);
    writeFileSync(join(lock, "owner.json"), JSON.stringify({ pid: deadPid(), startedAt: null }));

    const release = acquireNodeSession(root);
    // The reclaimed lock is a real lock: a competitor still cannot enter.
    expect(() => acquireNodeSession(root)).toThrow("session");
    release();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a live owner is never reclaimed even when the record says otherwise", () => {
  const root = mkdtempSync(join(tmpdir(), "kunai-mobile-session-"));
  try {
    const first = acquireNodeSession(root);
    // Overwrite our own owner record with a stale lookalike — the recorded
    // pid is this process, which is alive, so reclaim must refuse.
    expect(() => acquireNodeSession(root)).toThrow("session");
    first();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
