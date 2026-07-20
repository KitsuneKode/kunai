import { footerKeyFromBinding, KEYBINDINGS, type KeyBinding } from "@/app-shell/keybindings";
import { isLocalPlaybackStream } from "@/app/playback/playback-source-ui";
import {
  buildPlaybackControlSummary,
  type PlaybackSessionControlInput,
} from "@/app/playback/source-quality";

export type PlaybackSessionKeysInput = PlaybackSessionControlInput & {
  readonly hasNextEpisode: boolean;
  readonly hasPreviousEpisode: boolean;
};

type PlaybackHintId =
  | "command-palette"
  | "player-autoplay"
  | "player-autoskip"
  | "player-episode"
  | "player-next"
  | "player-previous"
  | "player-quality"
  | "player-source"
  | "player-stop"
  | "player-stop-after-current";

function findHintBinding(id: PlaybackHintId, bindings: readonly KeyBinding[]): KeyBinding | null {
  return bindings.find((binding) => binding.id === id) ?? null;
}

function appendBindingHint(
  parts: string[],
  bindings: readonly KeyBinding[],
  id: PlaybackHintId,
  labelOverride?: string,
): void {
  const binding = findHintBinding(id, bindings);
  if (!binding) return;
  parts.push(
    `${footerKeyFromBinding(binding)} ${labelOverride ?? binding.hintLabel ?? binding.label}`,
  );
}

function appendPlaybackSessionStatusChips(
  parts: string[],
  input: Pick<
    PlaybackSessionKeysInput,
    "autoplayPaused" | "autoskipPaused" | "canToggleAutoplay" | "stopAfterCurrent" | "isSeries"
  >,
): void {
  if (input.canToggleAutoplay) {
    parts.push(input.autoplayPaused ? "autoplay paused" : "autoplay on");
  }
  parts.push(input.autoskipPaused ? "autoskip paused" : "autoskip on");
  if (input.isSeries && input.stopAfterCurrent) {
    parts.push("stops after ep");
  }
}

/** Session state + live-key legend (one line; omit nav keys when unavailable). */
export function formatPlaybackSessionKeysHint(
  input: PlaybackSessionKeysInput,
  bindings: readonly KeyBinding[] = KEYBINDINGS,
): string {
  const control = buildPlaybackControlSummary(input.stream);
  const parts: string[] = [];

  if (input.stream && isLocalPlaybackStream(input.stream)) {
    parts.push("↓ offline");
  } else if (input.stream?.providerResolveResult) {
    parts.push("online");
  }

  appendPlaybackSessionStatusChips(parts, input);
  appendBindingHint(parts, bindings, "player-stop");

  if (input.isSeries) {
    if (input.hasNextEpisode) appendBindingHint(parts, bindings, "player-next");
    if (input.hasPreviousEpisode) appendBindingHint(parts, bindings, "player-previous");
    appendBindingHint(
      parts,
      bindings,
      "player-stop-after-current",
      input.stopAfterCurrent ? "resume chain" : undefined,
    );
  }

  if (input.canToggleAutoplay) {
    appendBindingHint(parts, bindings, "player-autoplay");
  }
  appendBindingHint(parts, bindings, "player-autoskip");

  if (control.showSourceControl) {
    appendBindingHint(parts, bindings, "player-source");
  }
  if (control.showQualityControl) {
    appendBindingHint(parts, bindings, "player-quality");
  }
  if (input.isSeries) {
    appendBindingHint(parts, bindings, "player-episode");
  }

  appendBindingHint(parts, bindings, "command-palette");
  return parts.join(" · ");
}
