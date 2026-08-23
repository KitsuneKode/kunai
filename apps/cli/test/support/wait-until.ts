/**
 * Wait for a condition, with a budget generous enough not to assert machine speed.
 *
 * Hand-rolled poll loops kept re-appearing across these suites in three shapes,
 * all of which make a test's result depend on the host rather than the code:
 *
 *   - a short bounded budget (`for (let i = 0; i < 100; i++) await Bun.sleep(10)`
 *     — one second) that silently gives up and lets the assertion below it fail
 *     with a misleading message;
 *   - an **unbounded** `while (!condition) await Bun.sleep(1)`, which cannot
 *     fail — it hangs until the runner's global timeout and reports as a
 *     timeout rather than as the condition that never held;
 *   - a fixed sleep standing in for synchronisation.
 *
 * The Windows agent is slower and, under `--parallel`, its scheduling shifts
 * whenever unrelated tests are added elsewhere. That is how three
 * `DownloadService` tests went red on a branch that touched no download code,
 * and how a `SyncService` drain timed out on a documentation-only change.
 *
 * The predicate returns the instant it is true, so a large ceiling costs
 * nothing when the code works. A genuinely broken condition still fails — just
 * after a wait that no longer depends on the host, and with a message naming
 * what was being waited for.
 */
export async function waitUntil(
  predicate: () => boolean,
  options: { readonly timeoutMs?: number; readonly label?: string } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (predicate()) return;
    await Bun.sleep(5);
  }

  // One last check: the loop can exit on the deadline in the same tick the
  // condition became true, and failing then would be its own flake.
  if (predicate()) return;

  throw new Error(
    options.label
      ? `waitUntil(${options.label}) timed out after ${timeoutMs}ms`
      : `waitUntil timed out after ${timeoutMs}ms`,
  );
}
