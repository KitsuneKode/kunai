import { classifyProviderResolveUserState } from "@/app/playback/provider-resolve-user-state";
import type { PlaybackFailureClass } from "@/domain/playback/playback-failure-class";

import { footerKeyFromBinding, KEYBINDINGS } from "./keybindings";
import type { ActionRowModel } from "./primitives/ActionList.model";
import type { StateBlockModel } from "./primitives/StateBlock.model";
import type { LoadingShellState } from "./types";

export type PlaybackRecoveryViewModel = {
  readonly state: StateBlockModel;
  readonly actions: readonly ActionRowModel[];
};

type RecoveryBucket = "stalled" | "did-not-start";

function bucketForFailureClass(failureClass: PlaybackFailureClass): RecoveryBucket | null {
  switch (failureClass) {
    case "network-buffering":
    case "slow-stream":
    case "seek-stuck":
    case "ipc-stuck":
    case "expired-stream":
    case "video-lost":
      return "stalled";
    case "player-exited":
    case "video-not-decoding":
    case "unknown":
      return "did-not-start";
    case "none":
      return null;
  }
}

export function buildPlaybackRecoveryViewModel(
  state: LoadingShellState,
): PlaybackRecoveryViewModel | null {
  const fromClass = state.failureClass ? bucketForFailureClass(state.failureClass) : null;
  const stalled = state.bufferHealth === "stalled" || fromClass === "stalled";
  const didNotStart = !stalled && fromClass === "did-not-start";
  const degraded = state.problem?.severity === "recoverable";
  const classified = classifyProviderResolveUserState({ problem: state.problem });
  const noSource = !stalled && !didNotStart && classified?.state === "no-playable-source";

  if (!stalled && !didNotStart && !noSource && !degraded && !classified) return null;

  const hardFailure = stalled || didNotStart || noSource;
  const actions: ActionRowModel[] = [];
  if (hardFailure) {
    actions.push({
      id: "recover",
      label: "Recover",
      detail: "Refresh this stream and resume from saved progress",
      shortcut: "r",
      tone: "warning",
    });
  }
  if (state.fallbackAvailable) {
    actions.push({
      id: "fallback",
      label: "Fallback",
      detail: state.fallbackProviderName
        ? `Try ${state.fallbackProviderName}`
        : "Try another compatible provider",
      shortcut: (() => {
        const binding = KEYBINDINGS.find((entry) => entry.id === "player-fallback");
        return binding ? footerKeyFromBinding(binding) : "⇧F";
      })(),
      tone: "warning",
    });
  }
  if (hardFailure) {
    actions.push({
      id: "sources",
      label: "Sources",
      detail: "Choose a different source or stream variant",
      shortcut: "o",
    });
  }
  actions.push({
    id: "diagnostics",
    label: "Diagnostics",
    detail: "Open trace and playback evidence",
    shortcut: "d",
    tone: "muted",
  });

  const title = stalled
    ? "Stream stalled"
    : didNotStart
      ? "Playback did not start"
      : noSource
        ? "No playable source found"
        : (classified?.title ?? "Provider issue for this title");

  return {
    state: {
      kind: hardFailure ? "error" : "info",
      title,
      detail: hardFailure
        ? "Progress is preserved. Kunai will not mark this episode watched until playback recovers."
        : (classified?.detail ??
          "Kunai is trying a safer path. You can fallback or inspect diagnostics."),
      actions,
    },
    actions,
  };
}
