import { describe, expect, test } from "bun:test";
import { readdirSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";

import { toPosixPath } from "../../support/repo-scan";

const CLI_SRC = join(import.meta.dir, "../../../src");

/** Src-relative POSIX path, so allowlist lookups match on Windows too. */
function srcRelative(absolute: string): string {
  return toPosixPath(relative(CLI_SRC, absolute));
}

/**
 * Existing PascalCase `.ts` files — migration debt per
 * `.docs/runtime-boundary-map.md`: new `.ts` logic modules must be kebab-case,
 * and these are renamed only under the rename policy documented there.
 *
 * This list is deliberately **static and hand-maintained**, and may only ever
 * shrink. It was previously populated by walking the same tree the test then
 * checked, which made the assertion `A ⊆ A` — it could not fail, and silently
 * adopted every new PascalCase file instead of rejecting it.
 */
const PASCAL_CASE_TS_ALLOWLIST = new Set<string>([
  "app/playback/DownloadOnlyPhase.ts",
  "app/playback/PlaybackPhase.ts",
  "app/search/SearchPhase.ts",
  "app/session/Phase.ts",
  "app/session/SessionController.ts",
  "domain/continuation/ContinuationEngine.ts",
  "domain/lists/ListService.ts",
  "domain/lists/StatsFormatter.ts",
  "domain/lists/StatsService.ts",
  "domain/lists/WatchGenreStats.ts",
  "domain/offline/OfflineLibraryEngine.ts",
  "domain/playback-source/SourceSelectionEngine.ts",
  "domain/provider/ProviderAttemptTimeline.ts",
  "domain/provider/ProviderFailureClassifier.ts",
  "domain/queue/QueuePlanner.ts",
  "domain/queue/QueueService.ts",
  "domain/recovery/RecoveryPolicy.ts",
  "domain/search/SearchIntent.ts",
  "domain/search/SearchIntentEngine.ts",
  "domain/search/SearchIntentParser.ts",
  "domain/session/PickerModel.ts",
  "domain/session/SessionState.ts",
  "domain/session/SessionStateManager.ts",
  "infra/logger/Logger.ts",
  "infra/logger/StructuredLogger.ts",
  "infra/player/PersistentMpvSession.ts",
  "infra/player/PlaybackStatsSnapshot.ts",
  "infra/player/PlayerControlService.ts",
  "infra/player/PlayerControlServiceImpl.ts",
  "infra/player/PlayerService.ts",
  "infra/player/PlayerServiceImpl.ts",
  "infra/shell/ShellService.ts",
  "infra/shell/ShellServiceImpl.ts",
  "infra/storage/FileStorage.ts",
  "infra/storage/StorageService.ts",
  "infra/timing/AniSkipTimingSource.ts",
  "infra/timing/IntroDbTimingSource.ts",
  "infra/timing/PlaybackTimingAggregator.ts",
  "infra/timing/PlaybackTimingSource.ts",
  "infra/tracer/Tracer.ts",
  "infra/tracer/TracerImpl.ts",
  "infra/work/WorkControlService.ts",
  "infra/work/WorkControlServiceImpl.ts",
  "services/attention/AttentionRefreshScheduler.ts",
  "services/attention/AttentionRefreshWorker.ts",
  "services/attention/FollowedTitleService.ts",
  "services/attention/RefreshBudgetPolicy.ts",
  "services/attention/ReleaseAvailabilityService.ts",
  "services/background/BackgroundWorkScheduler.ts",
  "services/catalog/CatalogDiscoveryService.ts",
  "services/catalog/CatalogIdentityService.ts",
  "services/catalog/CatalogScheduleService.ts",
  "services/catalog/ResultEnrichmentService.ts",
  "services/catalog/TimelineService.ts",
  "services/catalog/TitleDetailService.ts",
  "services/continuation/ContinuationProjectionService.ts",
  "services/continuation/ContinueWatchingService.ts",
  "services/diagnostics/DebugTraceReporter.ts",
  "services/diagnostics/DiagnosticsBundleBuilder.ts",
  "services/diagnostics/DiagnosticsService.ts",
  "services/diagnostics/DiagnosticsServiceImpl.ts",
  "services/diagnostics/DiagnosticsStore.ts",
  "services/diagnostics/DiagnosticsStoreImpl.ts",
  "services/diagnostics/DurableDiagnosticsSink.ts",
  "services/diagnostics/IssueReportBuilder.ts",
  "services/diagnostics/ResolveTraceSink.ts",
  "services/download/DownloadFeature.ts",
  "services/download/DownloadIntentService.ts",
  "services/download/DownloadService.ts",
  "services/download/StorageBudgetPolicy.ts",
  "services/history-metadata/HistoryIdentityConsolidator.ts",
  "services/history-metadata/HistoryIdentityEnrichBackfill.ts",
  "services/history-metadata/HistoryMetadataHealer.ts",
  "services/history-metadata/HistoryWatchLedgerBackfill.ts",
  "services/media-actions/MediaActionRouter.ts",
  "services/network/Connectivity.ts",
  "services/network/NetworkStatus.ts",
  "services/notifications/NotificationActionRouter.ts",
  "services/notifications/NotificationEngine.ts",
  "services/notifications/NotificationService.ts",
  "services/offline/OfflineAssetService.ts",
  "services/offline/OfflineLibraryService.ts",
  "services/offline/OfflineMaintenanceService.ts",
  "services/offline/OfflineRunwayService.ts",
  "services/persistence/CacheStore.ts",
  "services/persistence/ConfigService.ts",
  "services/persistence/ConfigServiceImpl.ts",
  "services/persistence/ConfigStore.ts",
  "services/persistence/ConfigStoreImpl.ts",
  "services/persistence/SqliteCacheStoreImpl.ts",
  "services/persistence/StorageMaintenanceService.ts",
  "services/persistence/SyncTokenStore.ts",
  "services/playback/EpisodePlaybackSelectionService.ts",
  "services/playback/MediaTrackService.ts",
  "services/playback/PlaybackResolveCoordinator.ts",
  "services/playback/PlaybackResolveService.ts",
  "services/playback/PlaybackResolveWorkService.ts",
  "services/playback/PlaybackSourceInventoryProjection.ts",
  "services/playback/PlaybackSourceInventoryView.ts",
  "services/playback/ProviderCandidatePlanner.ts",
  "services/playback/ProviderEndpointHealthService.ts",
  "services/playback/ProviderHealthEvidence.ts",
  "services/playback/ResolveResultCommitPolicy.ts",
  "services/playback/ResolveWorkLedger.ts",
  "services/playback/SourceInventoryService.ts",
  "services/playback/StreamHealthService.ts",
  "services/playback/TitlePlaybackSourceService.ts",
  "services/playback/TitleProviderHealthService.ts",
  "services/playback/VideasyLazySourceProbeService.ts",
  "services/playlists/DurablePlaylistService.ts",
  "services/playlists/KunaiPlaylistFormat.ts",
  "services/playlists/PlaylistProjectionService.ts",
  "services/presence/PresenceService.ts",
  "services/presence/PresenceServiceImpl.ts",
  "services/providers/Provider.ts",
  "services/providers/ProviderRegistry.ts",
  "services/recommendations/RecommendationService.ts",
  "services/recommendations/RecommendationServiceImpl.ts",
  "services/release-reconciliation/ReleaseProgressWriter.ts",
  "services/release-reconciliation/ReleaseReconciliationPlanner.ts",
  "services/release-reconciliation/ReleaseReconciliationService.ts",
  "services/search/SearchRegistry.ts",
  "services/search/SearchRoutingService.ts",
  "services/search/SearchService.ts",
  "services/sync/AniListAdapter.ts",
  "services/sync/SyncAdapter.ts",
  "services/sync/SyncService.ts",
  "services/sync/TmdbAdapter.ts",
  "services/update/BinaryAutoUpdater.ts",
  "services/update/UpdateService.ts",
  "services/youtube/YoutubeRecommendationService.ts",
  "services/ytdlp/YtDlpService.ts",
]);

/** Existing kebab-case `.tsx` files outside PascalCase / *-shell / *-ui naming (migration allowlist). */
const TSX_NAMING_ALLOWLIST = new Set([
  "app-shell/dot-matrix-loader.tsx",
  "app-shell/library-title-detail.tsx",
  "app-shell/offscreen-freeze.tsx",
  "app-shell/overlay-layout-context.tsx",
  "app-shell/overlay-panel.tsx",
  "app-shell/overlay-picker-row.tsx",
  "app-shell/picker-overlay.tsx",
  "app-shell/poster-initial-block.tsx",
  "app-shell/root-status-shells.tsx",
  "app-shell/shell-command-mode.tsx",
  "app-shell/shell-frame.tsx",
  "app-shell/shell-primitives.tsx",
  "app-shell/skeleton.tsx",
]);

const ROOT_TS_ALLOWLIST = new Set([
  "main.ts",
  "container.ts",
  "cli-args.ts",
  "asset-modules.d.ts",
  "aniskip.ts",
  "introdb.ts",
  "logger.ts",
  "menu.ts",
  "mpv.ts",
  "search.ts",
  "session-flow.ts",
  "subtitle.ts",
  "tmdb.ts",
  "ui.ts",
]);

function walkTsFiles(directory: string, files: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const absolute = join(directory, entry);
    if (statSync(absolute).isDirectory()) {
      if (entry === "node_modules" || entry === "dist") continue;
      walkTsFiles(absolute, files);
      continue;
    }
    if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
      files.push(srcRelative(absolute));
    }
  }
  return files;
}

describe("filename conventions", () => {
  test("PascalCase .ts files stay on the migration allowlist only", () => {
    const violations: string[] = [];
    for (const file of walkTsFiles(CLI_SRC)) {
      const name = basename(file, ".ts");
      if (!/^[A-Z]/.test(name) || name.endsWith(".model")) continue;
      if (!PASCAL_CASE_TS_ALLOWLIST.has(file)) {
        violations.push(file);
      }
    }
    expect(violations).toEqual([]);
  });

  test("tsx files use PascalCase, *-shell.tsx, or *-ui.tsx", () => {
    const violations: string[] = [];
    function walkTsx(directory: string) {
      for (const entry of readdirSync(directory)) {
        const absolute = join(directory, entry);
        if (statSync(absolute).isDirectory()) {
          if (entry === "node_modules" || entry === "dist") continue;
          walkTsx(absolute);
          continue;
        }
        if (!entry.endsWith(".tsx")) continue;
        const rel = srcRelative(absolute);
        const ok =
          /^[A-Z]/.test(entry) || entry.endsWith("-shell.tsx") || entry.endsWith("-ui.tsx");
        if (!ok && !TSX_NAMING_ALLOWLIST.has(rel)) violations.push(rel);
      }
    }
    walkTsx(CLI_SRC);
    expect(violations).toEqual([]);
  });

  test("apps/cli/src root has no unexpected new .ts files", () => {
    const rootFiles = readdirSync(CLI_SRC).filter(
      (entry) => entry.endsWith(".ts") && statSync(join(CLI_SRC, entry)).isFile(),
    );
    const unexpected = rootFiles.filter((file) => !ROOT_TS_ALLOWLIST.has(file));
    expect(unexpected).toEqual([]);
  });
});
