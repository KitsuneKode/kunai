import { afterEach } from "bun:test";

import { __testing as curlImpersonateTesting } from "../../src/shared/curl-impersonate";

/**
 * File-level leak net for tests that patch process globals.
 *
 * Provider modules read `globalThis.fetch`, `Bun.which`, and
 * `process.env.PATH` at call time, so a test that swaps one and fails before
 * its local `finally` runs leaks the mock into every later test in the file —
 * and into the next file in the same `bun test` process. The order-dependent
 * flakes this prevents were real: the AniDB season-2 routing timeout and the
 * "wrapper added after first resolve" curl-candidate misses were leaked
 * globals, not product bugs.
 *
 * Snapshots are captured when the helper installs (module load, before any
 * test in the file runs), and every mutation is restored unconditionally after
 * each test. The curl PATH-scan cache is reset too — it memoizes on the PATH
 * value at scan time, so a restored PATH still serves a stale resolution.
 */
export function installGlobalRestore(): void {
  const originalFetch = globalThis.fetch;
  const originalWhich = Bun.which;
  const originalPath = process.env.PATH;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    Bun.which = originalWhich;
    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
    curlImpersonateTesting.resetPathCache();
  });
}
