import { afterEach } from "bun:test";

import { resetAniListClientForTest } from "@/services/catalog/anilist-client";
import { resetCatalogSourceLedgerForTest } from "@/services/catalog/catalog-source-ledger";

function configureTestEnvironment(): void {
  /** Block xdg-open / browser spawns during `bun test` unless a test opts out explicitly. */
  process.env.KUNAI_DISABLE_EXTERNAL_URL ??= "1";

  // Local test runners need the same privacy guarantee as CI, even in a TTY
  // with CI=0 or an inherited DO_NOT_TRACK=0. Consent/ingest unit fixtures may
  // inject env: {} only alongside isolated config and mocked/local delivery.
  process.env.DO_NOT_TRACK = "1";

  // Bun 1.4+ `--parallel` injects FORCE_COLOR=1 into worker processes under a PTY,
  // which overrides NO_COLOR inside supports-color/chalk and breaks Ink frame
  // assertions that expect plain text. Strip FORCE_COLOR and set NO_COLOR=1 unless
  // a caller explicitly opts into colored test output via KUNAI_TEST_COLOR=1.
  if (process.env.KUNAI_TEST_COLOR !== "1") {
    delete process.env.FORCE_COLOR;
    process.env.NO_COLOR = "1";
  }
}

configureTestEnvironment();

const nativeFetch = globalThis.fetch;

/**
 * A test that replaces `globalThis.fetch` must put it back before it ends.
 * A leaked fake answers every later request in the process — in a serial run
 * that is every later test file — so the failure surfaces far from its cause.
 * It once broke 53 unrelated tests and kept the weekly time-rot sweep red for
 * six weeks while looking like clock drift. This fails the leaking test itself
 * and restores the real fetch so nothing downstream inherits it.
 */
function failTestsThatLeakFetch(): void {
  afterEach(() => {
    // The shared AniList client keeps a process-wide rate-limit cooldown and
    // in-flight table; a test that answers 429 must not cool down every later
    // test's AniList calls.
    resetAniListClientForTest();
    resetCatalogSourceLedgerForTest();

    if (globalThis.fetch === nativeFetch) return;
    globalThis.fetch = nativeFetch;
    throw new Error(
      "This test left globalThis.fetch replaced. Restore it in afterEach (or a finally block) so a failing assertion cannot leak the mock into later tests.",
    );
  });
}

// The preload is also loaded by plain `bun` children (the privacy preload test
// spawns one). They inherit NODE_ENV, so only registering tells them apart:
// outside the runner `afterEach` throws, and there is no test to guard.
try {
  failTestsThatLeakFetch();
} catch {
  // Not under `bun test`.
}
