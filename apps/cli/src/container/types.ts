import type { ProviderEngine } from "@kunai/core";
import type {
  CalendarArchiveRepository,
  FollowedTitleRepository,
  HistoryRepository,
  KunaiDatabase,
  ListRepository,
  NotificationRepository,
  OfflineMaintenanceJobsRepository,
  OfflineTitlePoliciesRepository,
  PlaybackEventRepository,
  PlaylistsRepository,
  ProviderHealthRepository,
  QueueRepository,
  ReleaseProgressCacheRepository,
} from "@kunai/storage";

import type { AttentionFeatureFlags } from "../domain/features/feature-flags";
import type { ListService } from "../domain/lists/ListService";
import type { StatsFormatter } from "../domain/lists/StatsFormatter";
import type { StatsService } from "../domain/lists/StatsService";
import type { QueueService } from "../domain/queue/QueueService";
import type { SessionStateManager } from "../domain/session/SessionStateManager";
import type { Logger } from "../infra/logger/Logger";
import type { MpvRuntimeOptions } from "../infra/player/mpv-runtime-options";
import type { PlayerControlService } from "../infra/player/PlayerControlService";
import type { PlayerService } from "../infra/player/PlayerService";
import type { ShellService } from "../infra/shell/ShellService";
import type { StorageService } from "../infra/storage/StorageService";
import type { Tracer } from "../infra/tracer/Tracer";
import type { WorkControlService } from "../infra/work/WorkControlService";
import type { AttentionRefreshWorker } from "../services/attention/AttentionRefreshWorker";
import type { BackgroundWorkScheduler } from "../services/background/BackgroundWorkScheduler";
import type { CatalogScheduleService } from "../services/catalog/CatalogScheduleService";
import type { ResultEnrichmentService } from "../services/catalog/ResultEnrichmentService";
import type { TimelineService } from "../services/catalog/TimelineService";
import type { ContinuationProjectionService } from "../services/continuation/ContinuationProjectionService";
import type { ContinueWatchingService } from "../services/continuation/ContinueWatchingService";
import type { DiagnosticsService } from "../services/diagnostics/DiagnosticsService";
import type { DiagnosticsStore } from "../services/diagnostics/DiagnosticsStore";
import type { DownloadService } from "../services/download/DownloadService";
import type { HistoryMetadataHealer } from "../services/history-metadata/HistoryMetadataHealer";
import type { Connectivity } from "../services/network/Connectivity";
import type { NotificationService } from "../services/notifications/NotificationService";
import type { OfflineAssetService } from "../services/offline/OfflineAssetService";
import type { OfflineLibraryService } from "../services/offline/OfflineLibraryService";
import type { OfflineMaintenanceService } from "../services/offline/OfflineMaintenanceService";
import type { OfflineRunwayService } from "../services/offline/OfflineRunwayService";
import type { CacheStore } from "../services/persistence/CacheStore";
import type { ConfigService } from "../services/persistence/ConfigService";
import type { ConfigStore } from "../services/persistence/ConfigStore";
import type { StorageMaintenanceService } from "../services/persistence/StorageMaintenanceService";
import type { SyncTokenStore } from "../services/persistence/SyncTokenStore";
import type { EpisodePlaybackSelectionService } from "../services/playback/EpisodePlaybackSelectionService";
import type { MediaTrackService } from "../services/playback/MediaTrackService";
import type { PlaybackResolveWorkService } from "../services/playback/PlaybackResolveWorkService";
import type { ProviderEndpointHealthService } from "../services/playback/ProviderEndpointHealthService";
import type { SourceInventoryService } from "../services/playback/SourceInventoryService";
import type { TitlePlaybackSourceService } from "../services/playback/TitlePlaybackSourceService";
import type { TitleProviderHealthService } from "../services/playback/TitleProviderHealthService";
import type { VideasyLazySourceProbeService } from "../services/playback/VideasyLazySourceProbeService";
import type { DurablePlaylistService } from "../services/playlists/DurablePlaylistService";
import type { PresenceService } from "../services/presence/PresenceService";
import type { ProviderRegistry } from "../services/providers/ProviderRegistry";
import type { RecommendationService } from "../services/recommendations/RecommendationService";
import type { ReleaseProgressWriter } from "../services/release-reconciliation/ReleaseProgressWriter";
import type { ReleaseReconciliationService } from "../services/release-reconciliation/ReleaseReconciliationService";
import type { SearchRegistry } from "../services/search/SearchRegistry";
import type { SyncService } from "../services/sync/SyncService";
import type { BinaryAutoUpdater } from "../services/update/BinaryAutoUpdater";
import type { UpdateService } from "../services/update/UpdateService";
import type { CapabilitySnapshot } from "../ui";

export type ShellChrome = "default" | "minimal" | "quick";

/**
 * The container is the single source of truth for all dependencies.
 * No service should import concrete implementations - only interfaces from here.
 */
export interface Container {
  // Core services
  readonly logger: Logger;
  readonly tracer: Tracer;
  readonly config: ConfigService;
  readonly sessionId: string;

  // Engine and registries
  readonly engine: ProviderEngine;
  readonly providerRegistry: ProviderRegistry;
  readonly searchRegistry: SearchRegistry;

  // Infrastructure
  readonly shell: ShellService;
  readonly player: PlayerService;
  readonly playerControl: PlayerControlService;
  readonly workControl: WorkControlService;
  readonly storage: StorageService;

  // Persistence stores
  /** Raw SQLite repository — use when you need HistoryProgress directly (no adapter mapping). */
  readonly historyRepository: HistoryRepository;
  readonly playbackEventRepository: PlaybackEventRepository;
  readonly configStore: ConfigStore;
  readonly cacheStore: CacheStore;
  readonly cacheDb: KunaiDatabase;
  readonly diagnosticsStore: DiagnosticsStore;
  readonly diagnosticsService: DiagnosticsService;
  readonly storageMaintenance: StorageMaintenanceService;
  readonly sourceInventory: SourceInventoryService;
  readonly episodePlaybackSelection: EpisodePlaybackSelectionService;
  readonly titlePlaybackSource: TitlePlaybackSourceService;
  readonly videasyLazySourceProbe: VideasyLazySourceProbeService;
  readonly playbackResolveWork: PlaybackResolveWorkService;
  readonly mediaTrackService: MediaTrackService;
  readonly featureFlags: AttentionFeatureFlags;
  readonly providerHealth: ProviderHealthRepository;
  readonly endpointHealth: ProviderEndpointHealthService;
  readonly titleProviderHealth: TitleProviderHealthService;
  readonly downloadService: DownloadService;
  readonly offlineAssetService: OfflineAssetService;
  readonly offlineTitlePolicies: OfflineTitlePoliciesRepository;
  readonly offlineMaintenanceJobs: OfflineMaintenanceJobsRepository;
  readonly offlineLibraryService: OfflineLibraryService;
  readonly offlineMaintenanceService: OfflineMaintenanceService;
  readonly offlineRunwayService: OfflineRunwayService;
  readonly notificationService: NotificationService;
  readonly connectivity: Connectivity;
  readonly presence: PresenceService;

  // Session
  readonly stateManager: SessionStateManager;

  // Recommendations
  readonly recommendationService: RecommendationService;

  // Schedule/release tracking
  readonly catalogScheduleService: CatalogScheduleService;
  readonly releaseProgressCache: ReleaseProgressCacheRepository;
  readonly releaseProgressWriter: ReleaseProgressWriter;
  readonly calendarArchive: CalendarArchiveRepository;
  readonly releaseReconciliationService: ReleaseReconciliationService;
  readonly timelineService: TimelineService;
  readonly resultEnrichmentService: ResultEnrichmentService;
  readonly historyMetadataHealer: HistoryMetadataHealer;
  /** Session-scoped catalog episode totals learned from metadata heal (titleId → count). */
  readonly historyCatalogEpisodeCounts: Map<string, number>;
  readonly updateService: UpdateService;
  readonly binaryAutoUpdater: BinaryAutoUpdater;

  // Lists, playlist, stats, and sync
  readonly listRepository: ListRepository;
  readonly queueRepository: QueueRepository;
  readonly notificationRepository: NotificationRepository;
  readonly followedTitleRepository: FollowedTitleRepository;
  readonly playlistsRepository: PlaylistsRepository;
  readonly durablePlaylistService: DurablePlaylistService;
  readonly listService: ListService;
  readonly queueService: QueueService;
  readonly statsService: StatsService;
  readonly statsFormatter: StatsFormatter;
  readonly syncTokenStore: SyncTokenStore;
  readonly syncService: SyncService;
  readonly continuationProjectionService: ContinuationProjectionService;
  readonly continueWatchingService: ContinueWatchingService;
  readonly attentionRefreshWorker: AttentionRefreshWorker;
  readonly backgroundWorkScheduler: BackgroundWorkScheduler;

  /** CLI-driven shell density; minimal forces a minimal footer regardless of saved config. */
  readonly shellChrome: ShellChrome;
  /** Startup capability checks captured before container bootstrap. */
  readonly capabilitySnapshot: CapabilitySnapshot | null;
  /** JSONL diagnostics trace path when --debug-json or --debug-session is active. */
  readonly debugTracePath?: string;
  /** Human-readable startup notes for developer debug sessions only. */
  readonly debugSessionInstructions?: readonly string[];
  /** OS app data directory for user-owned exports (stats, traces). */
  readonly dataDir: string;
}

export function effectiveFooterHints(
  container: Pick<Container, "config" | "shellChrome">,
): "detailed" | "minimal" {
  if (container.config.minimalMode) return "minimal";
  if (container.shellChrome === "minimal" || container.shellChrome === "quick") return "minimal";
  return container.config.footerHints;
}

/**
 * Partial container for services that only need a subset of dependencies.
 * Use this for service constructors to declare minimal dependencies.
 */
export type ContainerDeps<T extends keyof Container> = Pick<Container, T>;

export interface ContainerOptions {
  debug?: boolean;
  mpv?: MpvRuntimeOptions;
  shellChrome?: ShellChrome;
  capabilitySnapshot?: CapabilitySnapshot | null;
  appVersion?: string;
  debugJson?: boolean;
  debugSession?: boolean;
}
