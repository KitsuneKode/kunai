import { subscribePlayerKeyRequests } from "@/domain/playback/player-key-requests";
import React from "react";

import {
  applyPlaybackShellInputEffect,
  resolvePlayerKeyRequest,
  type PlaybackShellInputContext,
} from "./playback-shell-input";

/**
 * Run keys pressed in the mpv window (delivered as keybinding ids) through the
 * same effect a terminal keypress gets, against the latest playback context.
 */
export function usePlayerKeyRequests(
  input: PlaybackShellInputContext,
  onToggleMemory: () => void,
): void {
  const latest = React.useRef({ input, onToggleMemory });
  latest.current = { input, onToggleMemory };
  React.useEffect(
    () =>
      subscribePlayerKeyRequests((bindingId) => {
        const { input: ctx, onToggleMemory: toggle } = latest.current;
        const effect = resolvePlayerKeyRequest(bindingId, ctx);
        if (effect) applyPlaybackShellInputEffect(effect, ctx.handlers, toggle);
      }),
    [],
  );
}
