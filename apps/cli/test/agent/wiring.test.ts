/**
 * L2 wiring scenarios — the tests plan 010 was blocked on. Each one drives the
 * REAL root shell + session loop with keystrokes and asserts BOTH the rendered
 * frame and the committed SQLite/config state in the same run, catching the
 * failure class unit tests cannot see: the silent no-op (a key that updates
 * the screen but writes nothing, a flag persisted but never read).
 *
 * One session per test — sessions share process env, so they are sequential,
 * never concurrent (the driver enforces this with a throwing guard).
 */
import { describe, expect, it } from "bun:test";

import { createAgentSession, type AgentSession } from "./agent-driver";
import { K } from "./keys";
import { onboardedConfig } from "./seed";

const SETTINGS_KEY = "/";

async function withSession(
  label: string,
  options: Parameters<typeof createAgentSession>[0],
  run: (session: AgentSession) => Promise<void>,
): Promise<void> {
  const session = await createAgentSession({ ...options, label });
  try {
    await run(session);
    session.assertPrivacyClean();
  } finally {
    await session.dispose();
  }
}

describe("agent wiring · settings toggle", () => {
  it("footer hints: Minimal persists to config.json and back", async () => {
    await withSession("wiring-settings", {}, async (s) => {
      await s.waitForFrame((f) => f.includes("Search title"), "browse shell");

      // Open the palette → /settings → Footer hints submenu → Minimal.
      // Each step waits for its surface — a human does the same; typing into a
      // palette that hasn't rendered yet drops keys (verified by failure).
      s.press(SETTINGS_KEY);
      await s.waitForFrame((f) => f.includes("command"), "command palette");
      s.press("settings", K.enter);
      await s.waitForFrame((f) => f.includes("Footer hints"), "settings panel");
      // The panel frame renders before its input handlers are fully attached —
      // keys sent into that gap are dropped (verified: immediate Down+Enter
      // never opened the submenu). A human's next keystroke lands after seeing
      // the settled surface; waitSettled is that beat.
      await s.waitSettled();
      s.press(K.down, K.enter);
      await s.waitForFrame((f) => f.includes("Minimal"), "footer-hints submenu");
      // Same input-attach gap as the panel: keys sent the instant the submenu
      // renders can be dropped — and "Minimal" matches the open submenu's
      // option row even when nothing was picked, so the frame predicate alone
      // can't tell pick from no-op. Settle, then assert the PICKED state:
      // the submenu closes and the panel list (with Usage analytics) returns.
      await s.waitSettled();
      s.press(K.down, K.enter);
      await s.waitForFrame(
        (f) => f.includes("Usage analytics") && f.includes("Minimal"),
        "pick applied — panel shows Minimal",
      );

      // Frame claims it AND the debounced config write lands — both required.
      await s.waitForBackend(
        (i) => i.config().footerHints === "minimal",
        "config.footerHints === minimal",
      );

      // Reverse the same path — a one-way door is a bug, not a feature.
      // Verified: the cursor stays on the picked row, so Enter reopens the
      // submenu with the cursor already on Detailed — no navigation near the
      // analytics toggle (hazard 3 is a real risk of sloppy key plans).
      s.press(K.enter);
      await s.waitForFrame((f) => f.includes("Detailed"), "footer-hints submenu again");
      await s.waitSettled();
      s.press(K.enter);
      await s.waitForFrame(
        (f) => f.includes("Usage analytics") && f.includes("Detailed"),
        "pick applied — panel shows Detailed",
      );
      await s.waitForBackend(
        (i) => i.config().footerHints === "detailed" || i.config().footerHints === undefined,
        "config.footerHints back to detailed",
      );
    });
  }, 30_000);
});

describe("agent wiring · queue", () => {
  it("q enqueues the highlighted result; x removes it in Up Next", async () => {
    await withSession("wiring-queue", {}, async (s) => {
      await s.waitForFrame((f) => f.includes("Search title"), "browse shell");

      s.press("movie", K.enter);
      await s.waitForFrame((f) => f.includes("Smoke Movie"), "fixture results");

      // `q` on the highlighted row — advertised as "up next" in the footer.
      const before = s.inspect().queue().length;
      s.press("q");
      await s.waitForBackend((i) => i.queue().length === before + 1, "playlist_queue +1 after q");
      const queued = s.inspect().queue();
      expect(queued.at(-1)?.title_id).toBe("tmdb:smoke-movie-1");

      // `Q` opens Up Next; `x` removes the selected row — reverse state. The
      // predicate must name the overlay uniquely: "Smoke Movie" also appears
      // on the results frame, which let the wait resolve before the overlay's
      // input handler attached — x then dropped into the gap and removed
      // nothing. waitSettled is the human beat between seeing the panel and
      // pressing a key on it.
      s.press("Q");
      await s.waitForFrame((f) => f.includes("UP NEXT"), "up-next surface");
      await s.waitSettled();
      s.press("x");
      await s.waitForBackend(
        (i) => i.queue().length === before,
        "playlist_queue back to baseline after x",
      );
    });
  }, 30_000);
});

describe("agent wiring · post-play history", () => {
  it("a played title lands in history_progress", async () => {
    await withSession("wiring-history", { mpv: "fake" }, async (s) => {
      await s.waitForFrame((f) => f.includes("Search title"), "browse shell");

      s.press("movie", K.enter);
      await s.waitForFrame((f) => f.includes("Smoke Movie"), "fixture results");
      s.press(K.enter);
      // Fake-mpv playback runs a real process spawn + EOF path — on a loaded
      // CI runner that exceeds the default 10s frame budget.
      await s.waitForFrame((f) => f.includes("Post-play"), "post-play surface", 30_000);

      await s.waitForBackend(
        (i) => i.history().some((row) => row.title_id === "tmdb:smoke-movie-1"),
        "history_progress contains the played title",
      );
    });
  }, 45_000);
});

describe("agent wiring · offline mode", () => {
  it("offline mode parks on the library instead of starving the session loop", async () => {
    // Regression for the livelock: offlineMode + empty query used to return a
    // synchronous `cancelled` from SearchPhase, and SessionController retried
    // it on pure microtasks — CPU spin, SIGINT undeliverable, dispose() never
    // resolving (only SIGKILL stopped the process). On the buggy code this
    // test times out before the first frame; on the fix the library surface
    // mounts, Esc closes and re-parks it, and shutdown lands through the
    // parked wait.
    await withSession(
      "wiring-offline",
      { seed: { ...onboardedConfig(), offlineMode: true } },
      async (s) => {
        await s.waitForFrame((f) => f.includes("Library"), "offline library surface");

        s.press(K.esc);
        await s.waitSettled();
        await s.waitForFrame((f) => f.includes("Library"), "library re-parked after esc");

        s.press(K.ctrlC);
        await s.waitSettled();
        expect(s.quitRequested()).not.toBeNull();
      },
    );
  }, 30_000);
});

describe("agent wiring · playback failure", () => {
  it("an exhausted startup failover still lets the session shut down", async () => {
    // Regression for the abort-blind error wait: showPlaybackError parked on a
    // stateManager.subscribe predicate that only a user dismissal could
    // satisfy — context.signal was never wired in, so after failover exhausted
    // its budget the phase outlived the abort and dispose() timed out on run().
    // withSession's finally disposes the session: pre-fix that threw after the
    // stop deadline; on the fix the abort releases the wait and it settles.
    await withSession(
      "wiring-failover",
      { mpv: "fake", fakeMpvMode: "fail-pre-loaded" },
      async (s) => {
        await s.waitForFrame((f) => f.includes("Search title"), "browse shell");
        s.press("smoke", K.enter);
        await s.waitForFrame((f) => f.includes("Smoke Movie"), "fixture results");
        s.press(K.enter);
        // Assert the failure actually happened from the backend — the frame
        // text on the failure surface is presentation detail; the committed
        // diagnostics row is the truth. Failover hops + diagnostic writes can
        // exceed the 10s budget on a loaded CI runner — the assertion is the
        // wait, not the speed.
        await s.waitForBackend(
          (i) =>
            i.tableRows("cache.diagnostic_events").some((row) => /failover|exhausted/i.test(row)),
          "diagnostic_events records failover exhaustion",
          30_000,
        );
      },
    );
  }, 45_000);
});
