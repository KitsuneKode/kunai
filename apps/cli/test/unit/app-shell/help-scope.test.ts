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

const stateWithOverlays = (
  playbackStatus: PlaybackStatus,
  ...types: readonly string[]
): SessionState =>
  ({ playbackStatus, activeModals: types.map((type) => ({ type })) }) as SessionState;

// This used to switch on playbackStatus alone, so `?` inside Up Next, History,
// Notifications, Library or Downloads showed *browse* help — leaving the
// bindings those surfaces define documented nowhere the user could reach.
test("resolveHelpScope documents the overlay the user is actually in", () => {
  expect(resolveHelpScope(stateWithOverlays("idle", "queue"))).toBe("queue");
  expect(resolveHelpScope(stateWithOverlays("idle", "history"))).toBe("history");
  expect(resolveHelpScope(stateWithOverlays("idle", "notifications"))).toBe("notifications");
  expect(resolveHelpScope(stateWithOverlays("idle", "library"))).toBe("library");
  expect(resolveHelpScope(stateWithOverlays("idle", "downloads"))).toBe("library");
});

// The overlay scope wins over playback: those keys are the live ones.
test("resolveHelpScope prefers the overlay over active playback", () => {
  expect(resolveHelpScope(stateWithOverlays("playing", "queue"))).toBe("queue");
  expect(resolveHelpScope(stateWithOverlays("finished", "notifications"))).toBe("notifications");
});

// `?` pushes `help` itself, and `confirm` is a transient prompt over a real
// surface; documenting either would be circular.
test("resolveHelpScope looks beneath the help and confirm overlays", () => {
  expect(resolveHelpScope(stateWithOverlays("idle", "queue", "help"))).toBe("queue");
  expect(resolveHelpScope(stateWithOverlays("idle", "history", "confirm", "help"))).toBe("history");
  expect(resolveHelpScope(stateWithOverlays("playing", "help"))).toBe("player");
});

// Pickers and panels have no scope of their own; browse/player is correct.
test("resolveHelpScope falls through for overlays without a dedicated scope", () => {
  expect(resolveHelpScope(stateWithOverlays("idle", "settings"))).toBe("browse");
  expect(resolveHelpScope(stateWithOverlays("playing", "episode_picker"))).toBe("player");
});
