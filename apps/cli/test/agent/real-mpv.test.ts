/**
 * Real-mpv playback proof (L3, opt-in).
 *
 * Gated by KUNAI_REAL_MPV=1 + mpv/ffmpeg/tmux on PATH. When the gate is off
 * this file lands in the skip line — the house rule ("a skip is not a pass")
 * is why the gate prints its reason instead of silently vacuous-passing.
 *
 * The assertion is deliberately two independent witnesses:
 *   - mpv's own IPC `time-pos` advancing (the player really decoded), and
 *   - Kunai's history_progress row (the app really noticed).
 * Either alone would be weaker: argv alone proves a spawn, a DB row alone
 * could come from a fixture shortcut. Both together mean the real chain ran.
 */
import { describe, expect, it } from "bun:test";

import { realMpvStatus, startRealMpvSession } from "./real-mpv";

const status = realMpvStatus();
if (!status.ok) {
  // Loud skip — printed so the skip line carries the reason, not silence.
  console.log(`real-mpv tier skipped: ${status.reason}`);
}

const itReal = status.ok ? it : it.skip;

describe("agent driver · real mpv tier", () => {
  itReal(
    "plays generated media through the real CLI (mpv IPC + history row)",
    async () => {
      const rm = await startRealMpvSession({ name: "real-mpv-proof" });
      try {
        const s = rm.session;
        await s.waitFor((f) => f.includes("Search title"), "browse shell");
        await s.send("smoke", "\r");
        await s.waitFor((f) => f.includes("Smoke Movie"), "fixture results");
        await s.send("\r");

        // Witness 1: mpv's IPC socket reports playback progress. The fixture
        // is 8s; poll fast enough to catch it before EOF releases the socket.
        let pos: number | null = null;
        const deadline = Date.now() + 15_000;
        while (Date.now() < deadline) {
          pos = await rm.mpvTimePos();
          if (pos !== null && pos > 0) break;
          await Bun.sleep(150);
        }
        expect(pos, "mpv IPC time-pos should advance past 0 (mpv really decoded)").toBeGreaterThan(
          0,
        );

        // Witness 2: Kunai's own watch-progress/history write lands in SQLite.
        // The post-play footer label is the stable marker — the body varies
        // with outcome (completed vs stopped early vs resume offer).
        await s.waitFor((f) => f.includes("Post-play"), "post-play surface");
        const history = s.inspect().history();
        expect(
          history.some((row) => row.title_id === "tmdb:smoke-movie-1"),
          "history_progress should record the played title (Kunai noticed playback)",
        ).toBe(true);
      } finally {
        await rm.stop();
      }
    },
    60_000,
  );
});
