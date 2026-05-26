import type { ProviderSelectionDecision, StartupPriority, StreamCandidate } from "@kunai/types";

export const BALANCED_QUALITY_WAIT_BUDGET_MS = 1_000;
export const QUALITY_FIRST_WAIT_BUDGET_MS = 4_000;

export function selectReadyStream(
  streams: readonly StreamCandidate[],
  input: {
    readonly startupPriority?: StartupPriority;
    readonly qualityPreference?: string;
    readonly preferredStreamId?: string;
    readonly preferredSourceId?: string;
    readonly requiredFallback?: boolean;
  },
): { readonly selected: StreamCandidate; readonly decision: ProviderSelectionDecision } {
  const startupPriority = input.startupPriority ?? "balanced";
  const explicit = streams.find((stream) =>
    input.preferredStreamId
      ? stream.id === input.preferredStreamId
      : input.preferredSourceId
        ? stream.sourceId === input.preferredSourceId
        : false,
  );
  const normalizedQualityPreference = input.qualityPreference?.toLowerCase();
  const preferredQuality = normalizedQualityPreference
    ? streams.find(
        (stream) =>
          stream.qualityLabel?.toLowerCase().includes(normalizedQualityPreference) ||
          String(stream.qualityRank ?? "").includes(normalizedQualityPreference),
      )
    : undefined;
  const ordered = [...streams].sort(
    (left, right) => (right.qualityRank ?? 0) - (left.qualityRank ?? 0),
  );
  const selected =
    explicit ?? preferredQuality ?? (startupPriority === "fast" ? streams[0] : ordered[0]);

  if (!selected) throw new Error("No ready stream candidates");

  const reason = explicit
    ? "explicit-source"
    : input.requiredFallback
      ? "ak-required"
      : startupPriority === "fast"
        ? "fast-start"
        : startupPriority === "quality-first"
          ? "quality-first"
          : (selected.qualityRank ?? 0) >= 1080
            ? "balanced-1080"
            : "balanced-ready";

  return {
    selected,
    decision: {
      startupPriority,
      reason,
      waitBudgetMs:
        startupPriority === "quality-first"
          ? QUALITY_FIRST_WAIT_BUDGET_MS
          : startupPriority === "balanced"
            ? BALANCED_QUALITY_WAIT_BUDGET_MS
            : 0,
      selectedQualityRank: selected.qualityRank,
      enrichmentLane: startupPriority === "quality-first" ? "optional-foreground" : "required",
    },
  };
}
