import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { removeTempDir } from "../../support/remove-temp-dir";

function busy(): NodeJS.ErrnoException {
  const error = new Error("EBUSY: resource busy or locked") as NodeJS.ErrnoException;
  error.code = "EBUSY";
  return error;
}

test("removes a real directory", () => {
  const dir = mkdtempSync(join(tmpdir(), "kunai-rmtest-"));
  writeFileSync(join(dir, "file.txt"), "x");
  removeTempDir(dir);
  expect(existsSync(dir)).toBe(false);
});

test("an undefined or already-gone path is a no-op", () => {
  expect(() => removeTempDir(undefined)).not.toThrow();
  expect(() => removeTempDir(join(tmpdir(), "kunai-rmtest-does-not-exist"))).not.toThrow();
});

/**
 * The Windows behaviour this exists for, exercised on any platform.
 *
 * POSIX unlinks a file with an open handle happily, so `EBUSY` cannot be
 * produced here for real — the removal is injected instead. Without this the
 * retry path would ship untested and only ever run on the one OS where it
 * matters.
 */
test("retries while the OS is still holding the directory, then succeeds", () => {
  let calls = 0;
  removeTempDir("/tmp/locked", {
    rm: () => {
      calls += 1;
      if (calls < 3) throw busy();
    },
  });
  expect(calls).toBe(3);
});

test("gives up with a warning rather than failing the suite", () => {
  const warnings: string[] = [];
  let calls = 0;

  expect(() =>
    removeTempDir("/tmp/permanently-locked", {
      attempts: 3,
      rm: () => {
        calls += 1;
        throw busy();
      },
      onGiveUp: (message) => warnings.push(message),
    }),
  ).not.toThrow();

  // A leftover temp directory is not a test failure — the OS reclaims it.
  expect(calls).toBe(3);
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toContain("still locked after 3 attempts");
});

test("a non-lock error is not retried", () => {
  let calls = 0;
  const fatal = new Error("EACCES: permission denied") as NodeJS.ErrnoException;
  fatal.code = "EACCES";

  removeTempDir("/tmp/not-ours", {
    rm: () => {
      calls += 1;
      throw fatal;
    },
  });

  // Spinning 20 times on a genuine permission problem would hide it.
  expect(calls).toBe(1);
});
