import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
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
