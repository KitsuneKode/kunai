/**
 * Outer playback-loop iteration directives (Track C1).
 * Pure planning for resolve-failure branches in PlaybackPhase.execute()'s
 * `while (true)` — side effects stay in the phase until wiring is safe.
 */

export type EpisodeIterationExitResult = "back_to_results";

export type EpisodeIterationDirective =
  | { readonly kind: "continue" }
  | { readonly kind: "exit"; readonly result: EpisodeIterationExitResult }
  | {
      readonly kind: "restart";
      readonly reason: "stream-switch-during-resolve" | "provider-fallback-skip" | "resolve-retry";
    };

export type ProviderResolveFailurePlanInput = {
  readonly streamResolved: boolean;
  readonly resolveAborted: boolean;
  readonly sessionAborted: boolean;
  readonly streamSwitchSelection: unknown | null;
  readonly resolveAbortIntent: "cancel" | "fallback" | null;
  readonly hasCompatibleFallbackProvider: boolean;
  /** From showPlaybackProblem when resolve was not user-aborted. */
  readonly problemAction: "dismiss" | "retry" | null;
};

/**
 * Maps the no-stream tail of a resolve attempt to the outer loop's next step.
 * Extracted from PlaybackPhase.execute() ~1634–1726.
 */
export function planEpisodeIterationDirective(
  input: ProviderResolveFailurePlanInput,
): EpisodeIterationDirective {
  if (input.streamResolved) {
    return { kind: "continue" };
  }

  if (input.resolveAborted && !input.sessionAborted) {
    if (input.streamSwitchSelection) {
      return { kind: "restart", reason: "stream-switch-during-resolve" };
    }
    if (input.resolveAbortIntent === "fallback" && input.hasCompatibleFallbackProvider) {
      return { kind: "restart", reason: "provider-fallback-skip" };
    }
    return { kind: "exit", result: "back_to_results" };
  }

  if (input.problemAction === "retry") {
    return { kind: "restart", reason: "resolve-retry" };
  }

  return { kind: "exit", result: "back_to_results" };
}
