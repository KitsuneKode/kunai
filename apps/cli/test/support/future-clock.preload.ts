/**
 * Run the suite as if it were months from now, to surface time-rot.
 *
 * Time-rot here is always the same shape: a test freezes an injected clock at
 * a date literal while the code under test — or a seed helper — reads the real
 * one. It is green on the day it is written and red forever after, and it
 * lands in CI looking like an unrelated regression. It has now bitten three
 * times: the prune-clock bomb, the stats-service window, and the sync retry
 * wake.
 *
 * A lint rule cannot see this: the literal is fine, the real clock is fine,
 * only the pairing is wrong. So detect it empirically instead — advance the
 * clock and see what stops working. A test that owns both sides of its clock
 * does not care what today is; one that half-owns it fails immediately.
 *
 *   bun run --cwd apps/cli test:future
 *
 * The shifted clock must keep ticking. Bun's `setSystemTime` freezes
 * `Date.now()`, which hung every deadline loop (locks, download budgets, mpv
 * reconnects) until the test timeout and buried the real time-rot under a
 * dozen false positives. So `Date` is offset instead — but a test that calls
 * `setSystemTime` itself still wins: its clock then diverges from the
 * monotonic wall clock, and the offset steps aside instead of fighting it.
 *
 * `test:future` skips the activation- and version-lock suites: they age lock
 * files by `Date.now() - stat.mtimeMs`, and no process-local clock can move
 * the kernel's mtimes, so every lock reads as 180 days stale by construction.
 *
 * Failures are not necessarily product bugs. They mark tests whose result
 * depends on the wall clock, which is worth knowing either way.
 */

const OFFSET_DAYS = Number(process.env.KUNAI_CLOCK_OFFSET_DAYS ?? "180");

if (Number.isFinite(OFFSET_DAYS) && OFFSET_DAYS !== 0) {
  const offsetMs = OFFSET_DAYS * 24 * 60 * 60 * 1000;
  const RealDate = Date;
  const realNow = RealDate.now.bind(RealDate);
  const wallNow = () => performance.timeOrigin + performance.now();
  // A test-owned clock sits far from wall time; a second of slack absorbs
  // drift between the two real clocks.
  const shiftedNow = () => {
    const now = realNow();
    return Math.abs(now - wallNow()) > 1_000 ? now : now + offsetMs;
  };

  class FutureDate extends RealDate {
    constructor(...args: ConstructorParameters<typeof Date> | []) {
      if (args.length === 0) super(shiftedNow());
      else super(...(args as ConstructorParameters<typeof Date>));
    }

    static override now(): number {
      return shiftedNow();
    }
  }

  globalThis.Date = FutureDate as DateConstructor;

  if (!process.env.KUNAI_CLOCK_OFFSET_QUIET) {
    console.error(
      `[future-clock] running ${OFFSET_DAYS} days ahead — failures mark wall-clock-dependent tests`,
    );
  }
}
