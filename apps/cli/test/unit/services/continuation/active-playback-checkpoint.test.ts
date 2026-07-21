import { expect, test } from "bun:test";

import { ActivePlaybackCheckpoint } from "@/services/continuation/active-playback-checkpoint";

test("flush runs the registered checkpoint; unregister makes flush a no-op", () => {
  const checkpoints: string[] = [];
  const active = new ActivePlaybackCheckpoint();
  const unregister = active.register(() => checkpoints.push("first"));
  active.flush();
  unregister();
  active.flush();
  expect(checkpoints).toEqual(["first"]);
});

test("registering a new checkpoint replaces the prior one", () => {
  const checkpoints: string[] = [];
  const active = new ActivePlaybackCheckpoint();
  active.register(() => checkpoints.push("first"));
  active.register(() => checkpoints.push("second"));
  active.flush();
  expect(checkpoints).toEqual(["second"]);
});

test("a stale unregister cannot clear the replacement checkpoint", () => {
  const checkpoints: string[] = [];
  const active = new ActivePlaybackCheckpoint();
  const staleUnregister = active.register(() => checkpoints.push("first"));
  active.register(() => checkpoints.push("second"));
  staleUnregister();
  active.flush();
  expect(checkpoints).toEqual(["second"]);
});

test("clear removes the checkpoint and invalidates pending unregisters", () => {
  const checkpoints: string[] = [];
  const active = new ActivePlaybackCheckpoint();
  active.register(() => checkpoints.push("first"));
  active.clear();
  active.flush();
  const unregister = active.register(() => checkpoints.push("second"));
  active.flush();
  unregister();
  active.flush();
  expect(checkpoints).toEqual(["second"]);
});

test("PlaybackPhase-style owned unregister only clears its own registration", () => {
  const checkpoints: string[] = [];
  const active = new ActivePlaybackCheckpoint();
  // Rejected short session owns this registration and must tear it down
  // without wiping a later playback's checkpoint (do not use clear()).
  const releaseOwned = active.register(() => checkpoints.push("rejected"));
  const keepAlive = active.register(() => checkpoints.push("live"));
  releaseOwned();
  active.flush();
  keepAlive();
  active.flush();
  expect(checkpoints).toEqual(["live"]);
});
