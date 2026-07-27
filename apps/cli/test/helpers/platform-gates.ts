import { describe } from "bun:test";

/**
 * Suites that exercise a POSIX-only artifact.
 *
 * These are not "Windows is broken" skips. `install.sh` is the Unix bootstrap
 * (Windows ships `install.ps1`, covered by its own suite), `script(1)` has no
 * Windows equivalent, and SIGINT/SIGTERM/SIGHUP are not real Windows signals.
 *
 * The gate has to be explicit because Git for Windows puts `bash` on PATH, so
 * "is bash available?" answers yes on a machine where the thing under test is
 * still not applicable — the suites then ran and failed on their own fixtures
 * rather than skipping.
 */
export const describePosixOnly = process.platform === "win32" ? describe.skip : describe;

/** Suites that exercise Windows-only behaviour. */
export const describeWindowsOnly = process.platform === "win32" ? describe : describe.skip;
