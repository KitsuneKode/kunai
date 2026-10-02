import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

test("a competing session message names the lock an operator can recover", () => {
  const root = mkdtempSync(join(tmpdir(), "kunai-mobile-session-"));
  try {
    const release = acquireNodeSession(root);
    try {
      acquireNodeSession(root);
      throw new Error("unreachable");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain("already active");
      expect(message).toContain(join(root, "session.lock"));
    }
    release();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a foreign lock path is still reported as contention", () => {
  const root = mkdtempSync(join(tmpdir(), "kunai-mobile-session-"));
  try {
    writeFileSync(join(root, "session.lock"), "foreign");
    try {
      acquireNodeSession(root);
      throw new Error("unreachable");
    } catch (error) {
      expect(error instanceof Error ? error.message : String(error)).toContain("already active");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
