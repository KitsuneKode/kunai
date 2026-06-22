import type { LineEditorKey } from "@/app-shell/line-editor";

import type { ShellInputCommand } from "./input-router";
import { matchBinding, type KeyBinding, type KeyScope } from "./keybindings";
import type { PlaybackShellInputEffect, PlaybackShellInputHandlers } from "./playback-shell-input";
import type { PlaybackShellResult } from "./types";

export function resolveKeybinding(
  scopes: readonly KeyScope[],
  input: string,
  key: LineEditorKey,
): KeyBinding | null {
  const orderedScopes = scopes.includes("global") ? scopes : (["global", ...scopes] as const);
  for (const scope of orderedScopes) {
    const binding = matchBinding(scope, input, key);
    if (binding) return binding;
  }
  return null;
}

export function resolveShellInputCommand(
  scopes: readonly KeyScope[],
  input: string,
  key: LineEditorKey,
): ShellInputCommand | null {
  const binding = resolveKeybinding(scopes, input, key);
  if (binding?.id === "quit") return "quit";
  if (binding?.id === "command-palette") return "open-command-palette";
  return null;
}

export function resolvePlaybackBindingEffect(
  binding: KeyBinding,
  input: {
    readonly isPlaying: boolean;
    readonly cancellable: boolean;
    readonly fallbackAvailable: boolean;
    readonly canOpenSourcePicker: boolean;
    readonly handlers: PlaybackShellInputHandlers;
  },
): PlaybackShellInputEffect | null {
  const { handlers } = input;
  switch (binding.id) {
    case "player-stop":
      if (input.isPlaying && handlers.onStop) return { kind: "stop" };
      if (input.cancellable && handlers.onCancel) return { kind: "cancel" };
      return null;
    case "player-next":
      return handlers.onNext ? { kind: "next" } : null;
    case "player-previous":
      return handlers.onPrevious ? { kind: "previous" } : null;
    case "player-fallback":
      return input.fallbackAvailable && handlers.onFallback ? { kind: "fallback" } : null;
    case "player-source":
      return input.canOpenSourcePicker && handlers.onPickSource ? { kind: "pick-source" } : null;
    case "player-episode":
      return handlers.onPickEpisode ? { kind: "pick-episode" } : null;
    case "player-skip":
      return handlers.onSkipSegment ? { kind: "skip-segment" } : null;
    case "player-quality":
      return handlers.onPickQuality ? { kind: "pick-quality" } : null;
    case "player-reload-subtitles":
      return handlers.onReloadSubtitles ? { kind: "reload-subtitles" } : null;
    case "player-return-search":
      return handlers.onReturnToSearch ? { kind: "return-to-search" } : null;
    case "player-autoplay":
      return handlers.onToggleAutoplay ? { kind: "toggle-autoplay" } : null;
    case "player-autoskip":
      return handlers.onToggleAutoskip ? { kind: "toggle-autoskip" } : null;
    case "player-stop-after-current":
      return handlers.onStopAfterCurrent ? { kind: "stop-after-current" } : null;
    case "player-memory":
      return { kind: "toggle-memory-panel" };
    case "player-diagnostics":
      return handlers.onCommandAction ? { kind: "shell-action", action: "diagnostics" } : null;
    case "help":
      return handlers.onCommandAction ? { kind: "shell-action", action: "help" } : null;
    default:
      return null;
  }
}

export function resolvePostPlaybackBindingResult(binding: KeyBinding): PlaybackShellResult | null {
  switch (binding.id) {
    case "post-continue":
      return "next";
    case "post-replay":
      return "replay";
    case "post-search":
      return "search";
    case "post-history":
      return "history";
    case "post-watchlist":
      return "bookmark";
    case "post-fallback":
      return "fallback";
    case "post-source":
      return "source";
    case "post-diagnostics":
      return "diagnostics";
    default:
      return null;
  }
}
