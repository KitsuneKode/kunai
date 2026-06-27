import type { CatalogEpisodeBounds } from "@/domain/continuation/catalog-episode-bounds";
import {
  classifyHistoryBucket,
  type HistoryBucket,
  type HistoryReleaseSignal,
} from "@/domain/continuation/history-bucket";
import {
  reconcileContinueHistory,
  type ContinueHistoryRelease,
} from "@/domain/continuation/history-reconciliation";
import { projectWatchProgress } from "@/domain/continuation/watch-progress";
import type { SessionState } from "@/domain/session/SessionState";
import type { ProviderMetadata } from "@/domain/types";
import type { ContinuationProjection } from "@/services/continuation/continuation-policy";
import {
  historyContentType,
  formatTimestamp,
  isFinished,
} from "@/services/continuation/history-progress";
import { buildDiagnosticsInsight } from "@/services/diagnostics/diagnostics-insight";
import type { DiagnosticEvent } from "@/services/diagnostics/DiagnosticsStore";
import { buildRuntimeHealthSnapshot } from "@/services/diagnostics/runtime-health";
import type { RuntimeMemorySample } from "@/services/diagnostics/runtime-memory";
import { resolveDownloadFeatureState } from "@/services/download/DownloadFeature";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import {
  formatProviderHealthBadge,
  formatProviderHealthPickerLabelSuffix,
  isProviderFallbackEligible,
  resolveEffectiveProviderHealth,
} from "@/services/playback/provider-health-policy";
import type { PresenceSnapshot } from "@/services/presence/PresenceService";
import { describePresenceConfiguration } from "@/services/presence/PresenceServiceImpl";
import type {
  HistoryProgress,
  ReleaseProgressDiagnosticsSummary,
} from "@/services/storage/storage-read-models";
import type { YoutubeDiagnosticsProbe } from "@/services/youtube/youtube-diagnostics-probes";
import {
  extractYoutubeProbeFromEvents,
  formatYoutubeDiagnosticsDetail,
} from "@/services/youtube/youtube-diagnostics-probes";
import { applyYoutubeHistoryEnrichment } from "@/services/youtube/youtube-history-metadata";
import type { CapabilitySnapshot } from "@/ui";
import type { ProviderHealth, ProviderId } from "@kunai/types";

import { buildHelpPanelCommandLines } from "../domain/session/command-registry";
import { buildDiagnosticsPanelLinesFromInsight } from "./diagnostics-panel-lines";
import { helpSections } from "./keybindings";
import { describeHistoryReturnLoopDetail } from "./root-history-bridge";
import type { ShellPanelLine, ShellPickerOption } from "./types";

export function buildHelpPanelLines(): readonly ShellPanelLine[] {
  // Key chords are derived from the keybinding registry (single source of truth)
  // so the help overlay can never drift from the keys that are actually bound.
  const keyLines: ShellPanelLine[] = helpSections().flatMap((section) => [
    { label: `─── ${section.group}`, detail: "", tone: "info" as const },
    ...section.items.map((item) => ({ label: item.keys, detail: item.label })),
  ]);

  const commandLines: ShellPanelLine[] = buildHelpPanelCommandLines().map((line) => ({
    label: line.label,
    detail: line.detail,
  }));

  return [
    ...keyLines,
    { label: "─── Panels & commands", detail: "", tone: "info" },
    ...commandLines,
  ];
}

export function buildAboutPanelLines({
  config,
  state,
  capabilitySnapshot,
}: {
  config: KitsuneConfig;
  state: SessionState;
  capabilitySnapshot?: CapabilitySnapshot | null;
}): readonly ShellPanelLine[] {
  const capabilityLine =
    capabilitySnapshot && capabilitySnapshot.issues.length > 0
      ? `${capabilitySnapshot.issues.length} degraded capability ${capabilitySnapshot.issues.length === 1 ? "check" : "checks"}`
      : "all required capabilities available";
  const downloadFeature = resolveDownloadFeatureState({
    config,
    capabilities: capabilitySnapshot,
  });
  return [
    {
      label: "Version",
      detail: "v0.1.0",
    },
    {
      label: "Runtime",
      detail: `Bun ${Bun.version}  ·  Node ${process.versions.node}`,
    },
    {
      label: "Current mode",
      detail: `${state.mode}  ·  Provider ${state.provider}`,
    },
    {
      label: "Default startup mode",
      detail: `${config.defaultMode}  ·  Series ${config.provider}  ·  Anime ${config.animeProvider}  ·  YouTube ${config.youtubeProvider}`,
    },
    {
      label: "Presence",
      detail: describePresenceConfiguration(config),
    },
    {
      label: "Downloads",
      detail: downloadFeature.downloadPath
        ? `${downloadFeature.detail}  ·  ${downloadFeature.downloadPath}`
        : downloadFeature.detail,
      tone:
        downloadFeature.status === "ready"
          ? "success"
          : downloadFeature.status === "missing-yt-dlp"
            ? "warning"
            : "neutral",
    },
    {
      label: "Capabilities",
      detail: capabilityLine,
      tone: capabilitySnapshot?.issues.length ? "warning" : "success",
    },
    {
      label: "Privacy",
      detail: "Diagnostics stay local unless you explicitly export or share them.",
    },
  ];
}

export type DiagnosticsPanelLineInput = {
  state: SessionState;
  recentEvents: readonly DiagnosticEvent[];
  capabilitySnapshot?: CapabilitySnapshot | null;
  downloadSummary?: { active: number; completed: number; failed?: number } | null;
  releaseSummary?: { titleCount: number; episodeCount: number } | null;
  releaseDiagnostics?: ReleaseProgressDiagnosticsSummary | null;
  presenceSnapshot?: PresenceSnapshot | null;
  memorySamples?: readonly RuntimeMemorySample[];
  providers?: readonly ProviderMetadata[];
  getProviderHealth?: (providerId: ProviderId) => ProviderHealth | undefined;
  youtubeProbe?: YoutubeDiagnosticsProbe | null;
  developerMode?: boolean;
};

export function buildDiagnosticsPanelLines({
  state,
  recentEvents,
  capabilitySnapshot,
  downloadSummary,
  releaseSummary,
  releaseDiagnostics,
  presenceSnapshot,
  memorySamples,
  providers,
  getProviderHealth,
  youtubeProbe,
  developerMode = false,
}: DiagnosticsPanelLineInput): readonly ShellPanelLine[] {
  const insight = buildDiagnosticsInsight({
    state,
    recentEvents,
    downloadSummary,
    releaseSummary,
    releaseDiagnostics,
    presenceSnapshot,
    memorySamples,
    getProviderHealth,
  });

  const baseLines = buildDiagnosticsPanelLinesFromInsight({ insight, developerMode });
  const supplemental = buildDiagnosticsSupplementalLines({
    state,
    recentEvents,
    capabilitySnapshot,
    providers,
    getProviderHealth,
    youtubeProbe,
    memorySamples,
  });

  if (supplemental.length === 0) return baseLines;

  const healthEnd = baseLines.findIndex((line) => line.label === "─── Current Playback Evidence");
  if (healthEnd < 0) return [...baseLines, ...supplemental];
  return [...baseLines.slice(0, healthEnd), ...supplemental, ...baseLines.slice(healthEnd)];
}

function buildDiagnosticsSupplementalLines({
  state,
  recentEvents,
  capabilitySnapshot,
  providers,
  getProviderHealth,
  youtubeProbe,
  memorySamples,
}: {
  state: SessionState;
  recentEvents: readonly DiagnosticEvent[];
  capabilitySnapshot?: CapabilitySnapshot | null;
  providers?: readonly ProviderMetadata[];
  getProviderHealth?: (providerId: ProviderId) => ProviderHealth | undefined;
  youtubeProbe?: YoutubeDiagnosticsProbe | null;
  memorySamples?: readonly RuntimeMemorySample[];
}): ShellPanelLine[] {
  const lines: ShellPanelLine[] = [];
  const providerMemoryLines =
    providers && getProviderHealth
      ? buildProviderMemoryPanelLines({
          providers,
          getProviderHealth,
          mode: state.mode,
        })
      : [];
  lines.push(...providerMemoryLines);

  const runtimeHealth = buildRuntimeHealthSnapshot({
    recentEvents,
    currentProvider: state.provider,
    memorySamples,
  });
  if (memorySamples && memorySamples.length > 0) {
    lines.push(runtimeHealth.memoryTrend);
  }

  const resolvedYoutubeProbe = youtubeProbe ?? extractYoutubeProbeFromEvents(recentEvents);
  const youtubeDiagnostics = resolvedYoutubeProbe
    ? formatYoutubeDiagnosticsDetail(resolvedYoutubeProbe)
    : null;
  if (youtubeDiagnostics) {
    lines.push(
      {
        label: "YouTube tooling",
        detail: youtubeDiagnostics.tooling,
        tone: youtubeDiagnostics.toolingTone,
      },
      {
        label: "Invidious metadata",
        detail: youtubeDiagnostics.invidious,
        tone: youtubeDiagnostics.invidiousTone,
      },
    );
  }

  if (capabilitySnapshot?.issues.length) {
    lines.push({
      label: "Capabilities",
      detail: capabilitySnapshot.issues.map((issue) => issue.id).join("  ·  "),
      tone: "warning",
    });
  }

  const continuationEvents = recentEvents.filter(
    (event) =>
      event.operation === "continuation.project" || event.operation === "continuation.source",
  );
  if (continuationEvents.length > 0) {
    lines.push({
      label: "Continue decision",
      detail: formatContinuationDecisionTimeline(continuationEvents),
      tone: "info",
    });
  }

  return lines;
}

function formatContinuationDecisionTimeline(events: readonly DiagnosticEvent[]): string {
  if (events.length === 0) {
    return "No continuation project/source events yet · startup --continue, History Continue, or Calendar continue-ready";
  }
  const latestProject = [...events]
    .reverse()
    .find((event) => event.operation === "continuation.project");
  const latestSource = [...events]
    .reverse()
    .find((event) => event.operation === "continuation.source");
  const parts = [
    latestProject
      ? `project ${String(latestProject.context?.surface ?? "unknown")} · ${String(latestProject.context?.kind ?? latestProject.message)}`
      : null,
    latestSource
      ? `source ${String(latestSource.context?.resolved ?? "?")} via ${String(latestSource.context?.preference ?? "auto")}`
      : null,
    `${events.length} event${events.length === 1 ? "" : "s"}`,
  ].filter(Boolean);
  return parts.join("  ·  ");
}

export function renderHistoryProgressBar(percentage: number): string {
  const totalBlocks = 10;
  const filledBlocks = Math.max(
    0,
    Math.min(totalBlocks, Math.round((percentage / 100) * totalBlocks)),
  );
  const emptyBlocks = totalBlocks - filledBlocks;
  return `[${"█".repeat(filledBlocks)}${"░".repeat(emptyBlocks)}]`;
}

function historyProgressDetails(entry: HistoryProgress): {
  percentage: number | null;
  text: string;
  bar: string | null;
} {
  const progress = projectWatchProgress({
    timestamp: entry.positionSeconds,
    duration: entry.durationSeconds,
    completed: entry.completed,
  });
  if (progress.completed) {
    return {
      percentage: 100,
      text: "watched",
      bar: renderHistoryProgressBar(100),
    };
  }
  if (progress.percentage !== null) {
    const percentage = progress.percentage;
    return {
      percentage,
      text: `${percentage}% watched`,
      bar: renderHistoryProgressBar(percentage),
    };
  }
  return { percentage: null, text: "position saved", bar: null };
}

function sortHistoryEntries(
  historyEntries: ReadonlyArray<[string, HistoryProgress]>,
): readonly [string, HistoryProgress][] {
  return [...historyEntries].sort(
    (a: [string, HistoryProgress], b: [string, HistoryProgress]) =>
      (new Date(b[1].updatedAt).getTime() || 0) - (new Date(a[1].updatedAt).getTime() || 0),
  );
}

const DAY_MS = 86_400_000;

/** Groups sorted history entries into recency buckets (Today / This Week / Earlier). */
export function groupHistoryByRecency(
  entries: ReadonlyArray<[string, HistoryProgress]>,
): { label: string; items: ReadonlyArray<[string, HistoryProgress]> }[] {
  const now = Date.now();
  const today: [string, HistoryProgress][] = [];
  const week: [string, HistoryProgress][] = [];
  const earlier: [string, HistoryProgress][] = [];

  for (const pair of entries) {
    const age = now - (new Date(pair[1].updatedAt).getTime() || 0);
    if (age < DAY_MS) today.push(pair);
    else if (age < DAY_MS * 7) week.push(pair);
    else earlier.push(pair);
  }

  return [
    ...(today.length ? [{ label: "Today", items: today }] : []),
    ...(week.length ? [{ label: "This Week", items: week }] : []),
    ...(earlier.length ? [{ label: "Earlier", items: earlier }] : []),
  ];
}

export function buildHistoryPanelLines(
  historyEntries: ReadonlyArray<[string, HistoryProgress]>,
): readonly ShellPanelLine[] {
  if (historyEntries.length === 0) {
    return [
      {
        label: "No watch history yet",
        detail:
          "Playback positions appear here after mpv reports a watched position or EOF duration. If this stays empty after playback, open Diagnostics and check for a skipped history save.",
      },
    ];
  }

  const sorted = sortHistoryEntries(historyEntries).slice(0, 30);
  const groups = groupHistoryByRecency(sorted);
  const lines: ShellPanelLine[] = [];

  for (const group of groups) {
    lines.push({ label: `─── ${group.label}`, detail: "", tone: "info" });
    for (const [titleId, entry] of group.items) {
      const displayEntry = applyYoutubeHistoryEnrichment(entry);
      const details = historyProgressDetails(displayEntry);
      const initial = displayEntry.title.trim().charAt(0).toUpperCase() || "?";
      lines.push({
        label:
          historyContentType(displayEntry) === "series"
            ? `${initial}  ${displayEntry.title}  ·  S${String(displayEntry.season ?? 1).padStart(2, "0")}E${String(displayEntry.episode ?? displayEntry.absoluteEpisode ?? 1).padStart(2, "0")}`
            : `${initial}  ${displayEntry.title}  ·  movie`,
        detail: `${details.bar ? `${details.bar} ` : ""}${details.text}  ·  provider ${displayEntry.providerId ?? "unknown"}  ·  id ${titleId}  ·  ${new Date(displayEntry.updatedAt).toLocaleDateString()}`,
      });
    }
  }

  return lines;
}

function relativeTime(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export type HistoryPickerOptionsContext = {
  readonly nextReleases?: ReadonlyMap<string, ContinueHistoryRelease>;
  readonly projections?: ReadonlyMap<string, ContinuationProjection>;
  // Authoritative release status per title (status + newEpisodeCount + releaseAt),
  // sourced directly from the ReleaseProgressProjection cache — NOT the lossy
  // ContinueHistoryRelease — so the `caught-up` signal survives for bucketing.
  readonly releaseSignals?: ReadonlyMap<string, HistoryReleaseSignal>;
  readonly catalogBounds?: ReadonlyMap<string, CatalogEpisodeBounds>;
};

/**
 * Single authority for which /history tab a title belongs in. Decides off the
 * honest release status via {@link classifyHistoryBucket}, never the optimistic
 * reconcile fallback. Used by both the Continue/Completed/New tabs and the hoisted
 * "Continue Watching" section so they can never disagree.
 */
export function historyBucketFor(
  id: string,
  entry: HistoryProgress,
  context: HistoryPickerOptionsContext = {},
): HistoryBucket {
  const projection = context.projections?.get(id);
  const hasKnownNextToPlay =
    projection?.kind === "offline-ready" || projection?.kind === "next-released";
  return classifyHistoryBucket({
    entry,
    release: context.releaseSignals?.get(id) ?? null,
    hasKnownNextToPlay,
    catalogBounds: context.catalogBounds?.get(id) ?? null,
  });
}

function formatSeriesEpisode(season: number, episode: number): string {
  return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
}

function buildHistoryOptionRow(
  id: string,
  entry: HistoryProgress,
  context: HistoryPickerOptionsContext,
): ShellPickerOption<string> {
  const displayEntry = applyYoutubeHistoryEnrichment(entry);
  const details = historyProgressDetails(displayEntry);
  const isCompleted = isFinished(displayEntry);
  const projection = context.projections?.get(id);
  const entrySeason = displayEntry.season ?? 1;
  const entryEpisode = displayEntry.episode ?? displayEntry.absoluteEpisode ?? 1;
  const episode =
    historyContentType(displayEntry) === "series"
      ? formatSeriesEpisode(entrySeason, entryEpisode)
      : "movie";
  if (projection?.kind === "offline-ready") {
    const directLocalPlay =
      projection.primaryAction?.kind === "play-local" && Boolean(projection.primaryAction.jobId);
    return {
      value: id,
      label: `${displayEntry.title}  ·  ${formatSeriesEpisode(projection.season, projection.episode)}`,
      detail: `${directLocalPlay ? "enter plays downloaded episode" : "download ready in /library"}  ·  ${projection.badge ?? "next episode ready"}  ·  completed ${episode}  ·  ${relativeTime(new Date(displayEntry.updatedAt))}`,
      badge: projection.badge ?? "offline",
      tone: "success",
      posterTitle: displayEntry.title,
    };
  }
  const decision = reconcileContinueHistory({
    titleId: id,
    entries: [[id, entry]],
    nextRelease: context.nextReleases?.get(id) ?? null,
    catalogBounds: context.catalogBounds?.get(id) ?? null,
  });
  // Gate the legacy reconcile's "new-episode" through the authoritative bucket so a
  // finished/caught-up title (or one with missing/stale release data) never shows a
  // fabricated "new" badge — the bucket classifier is conservative where reconcile is
  // optimistic. Without this, completed shows render "new" (the reported bug).
  const isNewEpisodeRow =
    decision.kind === "new-episode" && historyBucketFor(id, entry, context) === "new-episodes";
  const isContinueNextRow =
    decision.kind === "new-episode" &&
    typeof decision.episode === "number" &&
    historyBucketFor(id, entry, context) === "continue";
  if (isNewEpisodeRow || isContinueNextRow) {
    const nextEpisode =
      typeof decision.episode === "number"
        ? formatSeriesEpisode(decision.season ?? entrySeason, decision.episode)
        : episode;
    const completedEpisode =
      historyContentType(displayEntry) === "series"
        ? formatSeriesEpisode(entrySeason, entryEpisode)
        : "movie";
    const timeAgo = relativeTime(new Date(displayEntry.updatedAt));
    const returnLoopDetail = describeHistoryReturnLoopDetail({
      entry,
      nextRelease: context.nextReleases?.get(id) ?? null,
    });
    return {
      value: id,
      label: `${displayEntry.title}  ·  ${nextEpisode}`,
      detail: `${returnLoopDetail}  ·  completed ${completedEpisode}  ·  ${displayEntry.providerId ?? "unknown"}  ·  ${timeAgo}`,
      badge: isNewEpisodeRow ? (projection?.badge ?? "new") : "next",
      tone: "success",
      posterTitle: displayEntry.title,
    };
  }
  const statusGlyph = isCompleted
    ? "✓ complete"
    : displayEntry.positionSeconds > 10
      ? `⏸ ${formatTimestamp(displayEntry.positionSeconds)}`
      : "▶ start";
  const timeAgo = relativeTime(new Date(displayEntry.updatedAt));

  return {
    value: id,
    label:
      historyContentType(displayEntry) === "series"
        ? `${displayEntry.title}  ·  ${episode}`
        : `${displayEntry.title}  ·  movie`,
    detail: `${statusGlyph}  ·  ${displayEntry.providerId ?? "unknown"}  ·  ${timeAgo}`,
    posterTitle: displayEntry.title,
    historyProgress:
      details.percentage !== null
        ? { percentage: details.percentage, completed: isCompleted }
        : undefined,
    tone: isCompleted
      ? "success"
      : details.percentage !== null && details.percentage < 90
        ? "warning"
        : "neutral",
  };
}

/**
 * Single authority for "this title is something to keep watching" — the predicate
 * behind both the hoisted "Continue Watching" section and the /history Continue tab,
 * so the two surfaces can never disagree.
 *
 * Keep-watching = an in-progress title (resume) OR a finished SERIES episode that has
 * a next episode to play (Netflix-style advance). Finished movies and caught-up series
 * are done — they belong in Completed, not here.
 */
function isHistoryKeepWatching(
  id: string,
  entry: HistoryProgress,
  context: HistoryPickerOptionsContext = {},
): boolean {
  // The hoisted "Continue Watching" section is everything ACTIONABLE right now —
  // an in-progress resume (continue) OR a freshly-aired next episode (new-episodes).
  // This is broader than the /history Continue *tab* (which is strictly the
  // `continue` bucket, since New episodes has its own tab).
  const bucket = historyBucketFor(id, entry, context);
  return bucket === "continue" || bucket === "new-episodes";
}

export function buildHistoryPickerOptions(
  historyEntries: ReadonlyArray<[string, HistoryProgress]>,
  context: HistoryPickerOptionsContext = {},
): readonly ShellPickerOption<string>[] {
  const sorted = sortHistoryEntries(historyEntries);
  const continueWatching = sorted
    .filter(([id, entry]) => isHistoryKeepWatching(id, entry, context))
    .sort(([leftId], [rightId]) => {
      const rank = (id: string) => {
        const kind = context.projections?.get(id)?.kind;
        if (kind === "resume-unfinished") return 0;
        if (kind === "offline-ready") return 1;
        if (kind === "next-released") return 2;
        return 3;
      };
      return rank(leftId) - rank(rightId);
    });
  const continueIds = new Set(continueWatching.map(([id]) => id));
  const remainder = sorted.filter(([id]) => !continueIds.has(id));

  const options: ShellPickerOption<string>[] = [];

  if (continueWatching.length > 0) {
    options.push({
      value: "section:history-continue-watching",
      label: "Continue Watching",
    });
    for (const [id, entry] of continueWatching) {
      options.push(buildHistoryOptionRow(id, entry, context));
    }
  }

  const groups = groupHistoryByRecency(remainder);

  if (groups.length <= 1 && continueWatching.length === 0) {
    return remainder.map(([id, entry]) => buildHistoryOptionRow(id, entry, context));
  }

  if (groups.length <= 1) {
    for (const [id, entry] of remainder) {
      options.push(buildHistoryOptionRow(id, entry, context));
    }
    return options;
  }

  for (const group of groups) {
    options.push({
      value: `section:history-${group.label.toLowerCase().replace(/\s+/g, "-")}`,
      label: group.label,
    });
    for (const [id, entry] of group.items) {
      options.push(buildHistoryOptionRow(id, entry, context));
    }
  }
  return options;
}

export function sortProvidersByConfigPriority({
  providers,
  priority,
}: {
  providers: readonly ProviderMetadata[];
  priority: readonly string[];
}): ProviderMetadata[] {
  const rank = new Map<string, number>();
  priority.forEach((providerId, index) => {
    if (!rank.has(providerId)) rank.set(providerId, index);
  });
  return [...providers].sort(
    (left, right) =>
      (rank.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
      (rank.get(right.id) ?? Number.MAX_SAFE_INTEGER),
  );
}

export function buildProviderMemoryPanelLines(input: {
  readonly providers: readonly ProviderMetadata[];
  readonly getProviderHealth: (providerId: ProviderId) => ProviderHealth | undefined;
  readonly mode: SessionState["mode"];
}): readonly ShellPanelLine[] {
  const laneProviders = input.providers.filter((provider) => {
    if (input.mode === "youtube") return provider.isYoutubeProvider;
    if (input.mode === "anime") return provider.isAnimeProvider;
    return !provider.isAnimeProvider && !provider.isYoutubeProvider;
  });
  if (laneProviders.length === 0) {
    return [{ label: "Provider memory", detail: "No providers registered for this mode" }];
  }

  const lines: ShellPanelLine[] = [
    {
      label: "Provider memory",
      detail: `Active ${input.mode} lane · use /reset-provider-health to forget failures`,
      tone: "info",
    },
  ];

  for (const provider of laneProviders) {
    const effective = resolveEffectiveProviderHealth(
      input.getProviderHealth(provider.id as ProviderId),
    );
    const badge = formatProviderHealthBadge(effective ?? undefined);
    const fallbackNote =
      effective && !isProviderFallbackEligible(effective) ? " · skipped in auto-fallback" : "";
    lines.push({
      label: formatProviderName(provider),
      detail: badge ? `${badge}${fallbackNote}` : "no failure memory",
      tone:
        effective?.effectiveStatus === "down"
          ? "error"
          : effective?.effectiveStatus === "degraded"
            ? "warning"
            : "neutral",
    });
  }

  lines.push({
    label: "Recovery tips",
    detail: "/recompute ignores health for one attempt · degraded heals after ~1h · down after ~8h",
    tone: "neutral",
  });

  return lines;
}

export function buildProviderPickerOptions({
  providers,
  currentProvider,
  previewImageUrl,
  getProviderHealth,
}: {
  providers: readonly ProviderMetadata[];
  currentProvider: string;
  previewImageUrl?: string;
  getProviderHealth?: (providerId: ProviderId) => ProviderHealth | undefined;
}): readonly ShellPickerOption<string>[] {
  return providers.map((provider) => {
    const effective = getProviderHealth
      ? resolveEffectiveProviderHealth(getProviderHealth(provider.id as ProviderId))
      : undefined;
    const healthBadge = formatProviderHealthBadge(effective ?? undefined);
    const healthLabelSuffix = formatProviderHealthPickerLabelSuffix(effective ?? undefined);
    const healthDetail = healthBadge ? `Health: ${healthBadge}` : null;
    const baseDetail = formatProviderDetail(provider);
    const baseLabel =
      provider.id === currentProvider
        ? `${formatProviderName(provider)}  ·  current`
        : formatProviderName(provider);
    return {
      value: provider.id,
      label: healthLabelSuffix ? `${baseLabel}${healthLabelSuffix}` : baseLabel,
      detail: [baseDetail, healthDetail].filter(Boolean).join("  ·  "),
      previewImageUrl,
    };
  });
}

function formatProviderName(provider: ProviderMetadata): string {
  const status = provider.status === "candidate" ? "candidate" : null;
  return status ? `${provider.name}  ·  ${status}` : provider.name;
}

function formatProviderDetail(provider: ProviderMetadata): string {
  const aliases = provider.aliases?.length ? `Known as ${provider.aliases.join(", ")}` : null;
  return [provider.description, aliases].filter(Boolean).join("  ·  ");
}
