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

      // `Q` opens Up Next; `x` removes the selected row — reverse state.
      s.press("Q");
      await s.waitForFrame(
        (f) => f.includes("Up Next") || f.includes("Smoke Movie"),
        "up-next surface",
      );
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
      await s.waitForFrame((f) => f.includes("Post-play"), "post-play surface");

      await s.waitForBackend(
        (i) => i.history().some((row) => row.title_id === "tmdb:smoke-movie-1"),
        "history_progress contains the played title",
      );
    });
  }, 45_000);
});
