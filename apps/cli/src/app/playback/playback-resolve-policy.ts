import type { SourceRefreshDecision } from "@/app/playback/source-refresh-policy";
import type { RecoveryMode } from "@/domain/recovery/RecoveryPolicy";
import type { ProviderResolveInput } from "@kunai/types";

export type PlaybackResolvePolicy = {
  readonly honorExplicitProviderOnly: boolean;
  readonly preferFreshStream: boolean;
  readonly forceHealthCheck: boolean;
  readonly preserveCachedStreamOnFreshFailure: boolean;
  readonly ignoreTitleHealthSuggestion: boolean;
  readonly ignoreProviderHealth: boolean;
  readonly shouldInvalidateSuspectResolveState: boolean;
  readonly resolveIntent: ProviderResolveInput["intent"];
  readonly recoveryMode: RecoveryMode;
};

export function resolvePlaybackResolvePolicy(input: {
  readonly recomputeSources: boolean;
  readonly pendingUserProviderSwitch: boolean;
  readonly sourceRefreshDecision: SourceRefreshDecision | null;
  readonly configuredRecoveryMode: RecoveryMode;
}): PlaybackResolvePolicy {
  const sourceRefreshKind = input.sourceRefreshDecision?.kind;
  const sourceRefreshIsRecover = sourceRefreshKind === "recover";
  const sourceRefreshIsRefresh = sourceRefreshKind === "refresh";

  // Explicit recompute or manual recovery mode means the selected provider is
  // the whole request. A one-off provider switch is fresher than cache, but it
  // must not suppress fallback unless the user chose manual recovery mode.
  const honorExplicitProviderOnly =
    input.recomputeSources ||
    (input.pendingUserProviderSwitch && input.configuredRecoveryMode === "manual");
  const shouldInvalidateSuspectResolveState =
    sourceRefreshIsRecover || input.pendingUserProviderSwitch || input.recomputeSources;

  return {
    honorExplicitProviderOnly,
    preferFreshStream:
      honorExplicitProviderOnly ||
      sourceRefreshIsRefresh ||
      sourceRefreshIsRecover ||
      input.pendingUserProviderSwitch,
    forceHealthCheck: sourceRefreshIsRecover || input.pendingUserProviderSwitch,
    preserveCachedStreamOnFreshFailure: sourceRefreshIsRefresh && !honorExplicitProviderOnly,
    ignoreTitleHealthSuggestion: honorExplicitProviderOnly,
    ignoreProviderHealth: honorExplicitProviderOnly,
    shouldInvalidateSuspectResolveState,
    resolveIntent: input.recomputeSources ? "refresh" : "play",
    recoveryMode: honorExplicitProviderOnly ? "manual" : input.configuredRecoveryMode,
  };
}
