import type { PlaybackFailoverNotice } from "@/domain/playback/playback-failover-notice";

/** Registry display name. A missing name stays a generic word, never a raw id. */
export function providerDisplayName(name: string | null | undefined): string {
  const trimmed = name?.trim();
  return trimmed ? trimmed : "provider";
}

/**
 * Source label for a failover line. A missing label, or one that is the raw
 * source id, falls back to the provider's display name.
 */
export function playbackSourceDisplayLabel(input: {
  readonly sourceId: string | null | undefined;
  readonly inventory:
    | {
        readonly sources?: readonly { readonly id: string; readonly label?: string }[] | null;
      }
    | null
    | undefined;
  readonly providerName: string;
}): string {
  const providerName = providerDisplayName(input.providerName);
  const sourceId = input.sourceId?.trim() ?? "";
  if (!sourceId) return providerName;
  const label = input.inventory?.sources?.find((source) => source.id === sourceId)?.label?.trim();
  if (!label || label === sourceId) return providerName;
  return label;
}

export function buildPlaybackFailoverNotice(input: {
  readonly phase: PlaybackFailoverNotice["phase"];
  readonly fromLabel: string;
  readonly toLabel: string | null;
  readonly preservedSeconds: number | null;
}): PlaybackFailoverNotice {
  const fromLabel = providerDisplayName(input.fromLabel);
  const toLabel = input.toLabel?.trim() ? input.toLabel.trim() : null;
  const namedDestination = toLabel && toLabel !== fromLabel ? toLabel : null;
  const preservedSeconds =
    input.phase === "startup"
      ? null
      : input.preservedSeconds !== null && Number.isFinite(input.preservedSeconds)
        ? Math.max(0, Math.floor(input.preservedSeconds))
        : null;
  return {
    phase: input.phase,
    fromLabel,
    toLabel: namedDestination,
    preservedSeconds,
    tone: namedDestination ? "warn" : "error",
  };
}
