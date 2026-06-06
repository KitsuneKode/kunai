import type { ProviderSelectionDecision, StartupPriority, StreamCandidate } from "@kunai/types";

export const BALANCED_QUALITY_WAIT_BUDGET_MS = 1_000;
export const QUALITY_FIRST_WAIT_BUDGET_MS = 4_000;

// Local copy (providers package is standalone — avoid an app-layer import). Mirrors
// apps/cli/src/domain/playback/source-name.ts.
function normalizeSourceName(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function selectReadyStream(
  streams: readonly StreamCandidate[],
  input: {
    readonly startupPriority?: StartupPriority;
    readonly qualityPreference?: string;
    readonly preferredStreamId?: string;
    readonly preferredSourceId?: string;
    readonly favoriteSourceNames?: readonly string[];
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
  const favoriteSet = new Set(input.favoriteSourceNames ?? []);
  const favorite =
    favoriteSet.size > 0
      ? [...streams]
          .filter((stream) =>
            favoriteSet.has(
              normalizeSourceName(stream.serverName ?? stream.flavorLabel ?? stream.sourceId ?? ""),
            ),
          )
          .sort((left, right) => (right.qualityRank ?? 0) - (left.qualityRank ?? 0))[0]
      : undefined;
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
    explicit ??
    favorite ??
    preferredQuality ??
    (startupPriority === "fast" ? streams[0] : ordered[0]);

  if (!selected) throw new Error("No ready stream candidates");

  const reason = explicit
    ? "explicit-source"
    : favorite
      ? "favorite-source"
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
