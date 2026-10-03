import { expect, test } from "bun:test";

import { classifyProviderFailure } from "@kunai/core";

import { runAnidbCurlWithRetry } from "../src/anidb/client";

/**
 * Quitting kunai mid-resolve kills the curl child (exit 130). That message
 * matched neither "abort" nor "cancel", so the classifier read a plain Ctrl-C
 * as an unknown, retryable network fault — which spent a fallback provider
 * attempt during shutdown and logged an ERROR for a user who simply quit.
 */
function spawnExiting(exitCode: number) {
  return async () => ({ stdout: "", stderr: "", exitCode });
}

test("a signal-killed curl reports cancellation, not a network fault", async () => {
  const error = await runAnidbCurlWithRetry(["curl"], undefined, spawnExiting(130)).catch(
    (thrown: Error) => thrown,
  );

  expect(error).toBeInstanceOf(Error);
  // SAFETY: instanceof-asserted directly above.
  expect(classifyProviderFailure({ message: (error as Error).message }).failureClass).toBe(
    "user-cancelled",
  );
});

test("an aborted caller reports cancellation even when curl exits non-zero", async () => {
  const controller = new AbortController();
  controller.abort();

  const error = await runAnidbCurlWithRetry(["curl"], controller.signal, spawnExiting(1)).catch(
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- probing an untyped rejection value
    (thrown: unknown) => thrown,
  );

  const message = error instanceof Error ? error.message : String(error);
  const classified = classifyProviderFailure({ message });
  expect(classified.failureClass).toBe("user-cancelled");
  expect(classified.retryable).toBe(false);
  expect(classified.fallbackPolicy).toBe("no-fallback");
});

test("a genuine curl failure is still a failure, not a cancellation", async () => {
  const error = await runAnidbCurlWithRetry(["curl"], undefined, spawnExiting(6)).catch(
    (thrown: Error) => thrown,
  );

  // curl exit 6 is DNS resolution — the shared transport now reports the
  // structured kind instead of a bare exit line.
  // SAFETY: the runner throws Error objects; `(thrown: Error)` above pins it.
  const message = (error as Error).message;
  expect(message).toContain("curl exit 6");
  expect(message).toContain("no HTTP response");
  // SAFETY: same captured Error.
  expect(classifyProviderFailure({ message: (error as Error).message }).failureClass).not.toBe(
    "user-cancelled",
  );
});
