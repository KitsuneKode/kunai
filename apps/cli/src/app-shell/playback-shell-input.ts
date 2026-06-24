import type { LineEditorKey } from "@/app-shell/line-editor";

import { resolveKeybinding, resolvePlaybackBindingEffect } from "./keybinding-runtime";
import type { ShellAction } from "./types";

export type PlaybackShellInputHandlers = {
  readonly onCancel?: () => void;
  readonly onStop?: () => void;
  readonly onRecover?: () => void;
  readonly onReloadSubtitles?: () => void;
  readonly onNext?: () => void;
  readonly onPrevious?: () => void;
  readonly onSkipSegment?: () => void;
  readonly onPickEpisode?: () => void;
  readonly onPickSource?: () => void;
  readonly onPickQuality?: () => void;
  readonly onReturnToSearch?: () => void;
  readonly onToggleAutoplay?: () => void;
  readonly onToggleAutoskip?: () => void;
  readonly onStopAfterCurrent?: () => void;
  readonly onFallback?: () => void;
  readonly onCommandAction?: (action: ShellAction) => void;
};

export type PlaybackShellInputContext = {
  readonly operation: "resolving" | "playing" | "loading";
  readonly cancellable: boolean;
  readonly fallbackAvailable: boolean;
  readonly canOpenSourcePicker: boolean;
  /** Pre-playback failure / stall recovery surface. */
  readonly recoveryViewActive: boolean;
  /** Active playback with stall or issue copy (r/f/o/d row). */
  readonly playbackTroubleActive: boolean;
  readonly handlers: PlaybackShellInputHandlers;
};

export type PlaybackShellInputEffect =
  | { readonly kind: "cancel" }
  | { readonly kind: "stop" }
  | { readonly kind: "recover" }
  | { readonly kind: "fallback" }
  | { readonly kind: "pick-source" }
  | { readonly kind: "pick-episode" }
  | { readonly kind: "pick-quality" }
  | { readonly kind: "next" }
  | { readonly kind: "previous" }
  | { readonly kind: "skip-segment" }
  | { readonly kind: "reload-subtitles" }
  | { readonly kind: "return-to-search" }
  | { readonly kind: "toggle-autoplay" }
  | { readonly kind: "toggle-autoskip" }
  | { readonly kind: "stop-after-current" }
  | { readonly kind: "toggle-memory-panel" }
  | { readonly kind: "shell-action"; readonly action: ShellAction };

function normalizedKey(input: string): string {
  return input.toLowerCase();
}

function resolveRecoveryOrTroubleKeys(
  key: string,
  ctx: PlaybackShellInputContext,
): PlaybackShellInputEffect | null {
  const { handlers } = ctx;
  if (key === "r" && handlers.onRecover) return { kind: "recover" };
  if (key === "f" && ctx.fallbackAvailable && handlers.onFallback) return { kind: "fallback" };
  if (key === "o" && ctx.canOpenSourcePicker && handlers.onPickSource)
    return { kind: "pick-source" };
  if (key === "d" && handlers.onCommandAction) {
    return { kind: "shell-action", action: "diagnostics" };
  }
  return null;
}

function resolveBootstrapKeys(
  _input: string,
  key: string,
  ctx: PlaybackShellInputContext,
): PlaybackShellInputEffect | null {
  const { handlers } = ctx;
  if (key === "g" && handlers.onCommandAction) {
    return { kind: "shell-action", action: "settings" };
  }
  if (key === "h" && handlers.onCommandAction) {
    return { kind: "shell-action", action: "history" };
  }
  return null;
}

function resolvePlayingKeys(
  input: string,
  key: string,
  ctx: PlaybackShellInputContext,
): PlaybackShellInputEffect | null {
  const { handlers } = ctx;
  if (key === "r" && handlers.onRecover) return { kind: "recover" };
  // mpv maps quality to v; the terminal footer uses k from the keybinding registry.
  if (key === "v" && handlers.onPickQuality) return { kind: "pick-quality" };
  return null;
}

export function resolvePlaybackShellInput(
  input: string,
  key: LineEditorKey,
  ctx: PlaybackShellInputContext,
): PlaybackShellInputEffect | null {
  const normalized = normalizedKey(input);
  const isPlaying = ctx.operation === "playing";
  const binding = resolveKeybinding(["player"], input, key);

  if (ctx.recoveryViewActive || ctx.playbackTroubleActive) {
    const recoveryEffect = binding
      ? resolvePlaybackBindingEffect(binding, {
          isPlaying,
          cancellable: ctx.cancellable,
          fallbackAvailable: ctx.fallbackAvailable,
          canOpenSourcePicker: ctx.canOpenSourcePicker,
          handlers: ctx.handlers,
        })
      : resolveRecoveryOrTroubleKeys(normalized, ctx);
    if (recoveryEffect) return recoveryEffect;
  }

  if (binding) {
    const bindingEffect = resolvePlaybackBindingEffect(binding, {
      isPlaying,
      cancellable: ctx.cancellable,
      fallbackAvailable: ctx.fallbackAvailable,
      canOpenSourcePicker: ctx.canOpenSourcePicker,
      handlers: ctx.handlers,
    });
    if (bindingEffect) return bindingEffect;
  }

  if (!isPlaying) {
    return resolveBootstrapKeys(input, normalized, ctx);
  }

  return resolvePlayingKeys(input, normalized, ctx);
}

export function applyPlaybackShellInputEffect(
  effect: PlaybackShellInputEffect,
  handlers: PlaybackShellInputHandlers,
  onToggleMemoryPanel?: () => void,
): void {
  switch (effect.kind) {
    case "cancel":
      handlers.onCancel?.();
      return;
    case "stop":
      handlers.onStop?.();
      return;
    case "recover":
      handlers.onRecover?.();
      return;
    case "fallback":
      handlers.onFallback?.();
      return;
    case "pick-source":
      handlers.onPickSource?.();
      return;
    case "pick-episode":
      handlers.onPickEpisode?.();
      return;
    case "pick-quality":
      handlers.onPickQuality?.();
      return;
    case "next":
      handlers.onNext?.();
      return;
    case "previous":
      handlers.onPrevious?.();
      return;
    case "skip-segment":
      handlers.onSkipSegment?.();
      return;
    case "reload-subtitles":
      handlers.onReloadSubtitles?.();
      return;
    case "return-to-search":
      handlers.onReturnToSearch?.();
      return;
    case "toggle-autoplay":
      handlers.onToggleAutoplay?.();
      return;
    case "toggle-autoskip":
      handlers.onToggleAutoskip?.();
      return;
    case "stop-after-current":
      handlers.onStopAfterCurrent?.();
      return;
    case "toggle-memory-panel":
      onToggleMemoryPanel?.();
      return;
    case "shell-action":
      handlers.onCommandAction?.(effect.action);
      return;
    default: {
      const _exhaustive: never = effect;
      return _exhaustive;
    }
  }
}
