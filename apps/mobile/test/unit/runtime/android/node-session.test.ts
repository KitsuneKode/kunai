import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { acquireNodeSession } from "../../../../src/runtime/android/node-session";

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

test("a dead pid or a stale lock can be reclaimed", () => {
  const root = mkdtempSync(join(tmpdir(), "kunai-mobile-session-stale-"));
  const lock = join(root, "session.lock");
  try {
    mkdirSync(lock, { mode: 0o700 });
    writeFileSync(join(lock, "pid"), "999999\n");
    const reclaimed = acquireNodeSession(root, { isProcessAlive: () => false });
    reclaimed();

    mkdirSync(lock, { mode: 0o700 });
    const stale = acquireNodeSession(root, { isProcessAlive: () => true });
    stale();

    const held = acquireNodeSession(root, { isProcessAlive: () => true });
    expect(() => acquireNodeSession(root, { isProcessAlive: () => true })).toThrow("session");
    held();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
