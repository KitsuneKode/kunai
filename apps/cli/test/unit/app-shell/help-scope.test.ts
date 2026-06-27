import { expect, test } from "bun:test";

import { resolveHelpScope } from "@/app-shell/root-shell-state";
import type { PlaybackStatus, SessionState } from "@/domain/session/SessionState";

const stateWith = (playbackStatus: PlaybackStatus): SessionState =>
  ({ playbackStatus }) as SessionState;

test("resolveHelpScope maps active playback statuses to the player scope", () => {
  for (const status of [
    "loading",
    "ready",
    "buffering",
    "seeking",
    "stalled",
    "playing",
    "paused",
  ] as const) {
    expect(resolveHelpScope(stateWith(status))).toBe("player");
  }
});

test("resolveHelpScope maps a finished session to the post-play scope", () => {
  expect(resolveHelpScope(stateWith("finished"))).toBe("postPlayback");
});

test("resolveHelpScope falls back to browse when idle or errored", () => {
  expect(resolveHelpScope(stateWith("idle"))).toBe("browse");
  expect(resolveHelpScope(stateWith("error"))).toBe("browse");
});
