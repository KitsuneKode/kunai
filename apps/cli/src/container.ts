// =============================================================================
// Dependency Injection Container
//
// Simple DI without external libraries. Services receive the container
// and destructure only what they need.
// =============================================================================

import { existsSync } from "node:fs";
import { join } from "node:path";

import { createProviderTitleBridgePort } from "@/infra/storage/provider-title-bridge-port";
import { initLogger } from "@/logger";
import { runHistoryIdentityConsolidator } from "@/services/history-metadata/HistoryIdentityConsolidator";
import {
  createProviderEngine,
  isVideasyFamilyProvider,
  orderProviderModulesByPriority,
  type ProviderEngine,
} from "@kunai/core";
import { allmangaProviderModule } from "@kunai/providers/allmanga";
import { miruroProviderModule } from "@kunai/providers/miruro";
import { rivestreamProviderModule } from "@kunai/providers/rivestream";
import { videasyProviderModule } from "@kunai/providers/videasy";
import { listDeprecatedVidkingEndpoints } from "@kunai/providers/videasy";
import { vidlinkProviderModule } from "@kunai/providers/vidlink";
import { buildProviderRelayRegistry, createRelayFetchPort } from "@kunai/relay";
import {
  DownloadJobsRepository,
  DiagnosticEventsRepository,
  FollowedTitleRepository,
  getKunaiPaths,
  HistoryRepository,
  ListRepository,
  NotificationRepository,
  OfflineAssetsRepository,
  OfflineMaintenanceJobsRepository,
  OfflineTitlePoliciesRepository,
  openKunaiDatabase,
  QueueRepository,
  PlaylistsRepository,
  ProviderTitleBridgeRepository,
  ProviderHealthRepository,
  ProviderEndpointHealthRepository,
  TitleProviderHealthRepository,
  RecommendationCacheRepository,
  ReleaseProgressCacheRepository,
  CalendarArchiveRepository,
  runMigrations,
  isHistoryIdentityConsolidatorApplied,
  markHistoryIdentityConsolidatorApplied,
  ScheduleCacheRepository,
  SourceInventoryRepository,
  StreamCacheRepository,
} from "@kunai/storage";

import { getRootContentSession } from "./app-shell/root-content-state";
import {
  resolveAttentionFeatureFlags,
  type AttentionFeatureFlags,
} from "./domain/features/feature-flags";
import { ListService } from "./domain/lists/ListService";
import { StatsFormatter } from "./domain/lists/StatsFormatter";
import { StatsService } from "./domain/lists/StatsService";
import { QueueService } from "./domain/queue/QueueService";
import type { SessionStateManager } from "./domain/session/SessionStateManager";
import { SessionStateManagerImpl } from "./domain/session/SessionStateManager";
import type { Logger } from "./infra/logger/Logger";
// Import implementations
import { StructuredLogger } from "./infra/logger/StructuredLogger";
import type { MpvRuntimeOptions } from "./infra/player/mpv-runtime-options";
import type { PlayerPresentationPort } from "./infra/player/player-presentation-port";
import type { PlayerControlService } from "./infra/player/PlayerControlService";
import { PlayerControlServiceImpl } from "./infra/player/PlayerControlServiceImpl";
import type { PlayerService } from "./infra/player/PlayerService";
import { PlayerServiceImpl } from "./infra/player/PlayerServiceImpl";
import type { ShellService } from "./infra/shell/ShellService";
import { ShellServiceImpl } from "./infra/shell/ShellServiceImpl";
import { FileStorage } from "./infra/storage/FileStorage";
import type { StorageService } from "./infra/storage/StorageService";
import type { Tracer } from "./infra/tracer/Tracer";
import { TracerImpl } from "./infra/tracer/TracerImpl";
import type { WorkControlService } from "./infra/work/WorkControlService";
import { WorkControlServiceImpl } from "./infra/work/WorkControlServiceImpl";
import { AttentionRefreshWorker } from "./services/attention/AttentionRefreshWorker";
import { BackgroundWorkScheduler } from "./services/background/BackgroundWorkScheduler";
import {
  createCatalogScheduleService,
  type CatalogScheduleService,
} from "./services/catalog/CatalogScheduleService";
import { ResultEnrichmentService } from "./services/catalog/ResultEnrichmentService";
import { TimelineService } from "./services/catalog/TimelineService";
import { ContinuationProjectionService } from "./services/continuation/ContinuationProjectionService";
import { ContinueWatchingService } from "./services/continuation/ContinueWatchingService";
import { createCorrelationId } from "./services/diagnostics/correlation";
import {
  buildDebugSessionInstructions,
  DebugTraceReporter,
  resolveTraceCategories,
} from "./services/diagnostics/DebugTraceReporter";
import type { DiagnosticsService } from "./services/diagnostics/DiagnosticsService";
import { DiagnosticsServiceImpl } from "./services/diagnostics/DiagnosticsServiceImpl";
import type { DiagnosticsStore } from "./services/diagnostics/DiagnosticsStore";
import { DiagnosticsStoreImpl } from "./services/diagnostics/DiagnosticsStoreImpl";
import {
  AsyncDurableDiagnosticsSink,
  type DurableDiagnosticsSinkOptions,
} from "./services/diagnostics/DurableDiagnosticsSink";
import { redactDiagnosticValue } from "./services/diagnostics/redaction";
import { DownloadService } from "./services/download/DownloadService";
import { createHistoryMetadataResolver } from "./services/history-metadata/create-history-metadata-resolver";
import { HistoryMetadataHealer } from "./services/history-metadata/HistoryMetadataHealer";
import { Connectivity } from "./services/network/Connectivity";
import {
  mapRecordToSinkDelivery,
  NotificationSinkRegistry,
} from "./services/notifications/notification-sink";
import {
  LogNotificationSink,
  OsNotificationSink,
} from "./services/notifications/notification-sinks";
import { NotificationService } from "./services/notifications/NotificationService";
import { OfflineAssetService } from "./services/offline/OfflineAssetService";
import { OfflineLibraryService } from "./services/offline/OfflineLibraryService";
import { OfflineMaintenanceService } from "./services/offline/OfflineMaintenanceService";
import { OfflineRunwayService } from "./services/offline/OfflineRunwayService";
import type { CacheStore } from "./services/persistence/CacheStore";
import type { ConfigService } from "./services/persistence/ConfigService";
import { ConfigServiceImpl } from "./services/persistence/ConfigServiceImpl";
import type { ConfigStore } from "./services/persistence/ConfigStore";
import { ConfigStoreImpl } from "./services/persistence/ConfigStoreImpl";
import { SqliteCacheStoreImpl } from "./services/persistence/SqliteCacheStoreImpl";
import { StorageMaintenanceService } from "./services/persistence/StorageMaintenanceService";
import { SyncTokenStore } from "./services/persistence/SyncTokenStore";
import { EpisodePlaybackSelectionService } from "./services/playback/EpisodePlaybackSelectionService";
import { MediaTrackService } from "./services/playback/MediaTrackService";
import { PlaybackResolveCoordinator } from "./services/playback/PlaybackResolveCoordinator";
import { PlaybackResolveWorkService } from "./services/playback/PlaybackResolveWorkService";
import { resolveProviderAttemptTimeoutMs } from "./services/playback/provider-resolve-budget-policy";
import { ProviderEndpointHealthService } from "./services/playback/ProviderEndpointHealthService";
import { SourceInventoryService } from "./services/playback/SourceInventoryService";
import { StreamHealthService } from "./services/playback/StreamHealthService";
import { TitlePlaybackSourceService } from "./services/playback/TitlePlaybackSourceService";
import { TitleProviderHealthService } from "./services/playback/TitleProviderHealthService";
import { VideasyLazySourceProbeService } from "./services/playback/VideasyLazySourceProbeService";
import { DurablePlaylistService } from "./services/playlists/DurablePlaylistService";
import type { PresenceService } from "./services/presence/PresenceService";
import { PresenceServiceImpl } from "./services/presence/PresenceServiceImpl";
import { createProviderPrioritySnapshot } from "./services/providers/provider-priority";
import type { ProviderRegistry } from "./services/providers/ProviderRegistry";
import { createProviderRegistry } from "./services/providers/ProviderRegistry";
import type { RecommendationService } from "./services/recommendations/RecommendationService";
import { RecommendationServiceImpl } from "./services/recommendations/RecommendationServiceImpl";
import { loadCatalogProgress } from "./services/release-reconciliation/catalog-progress";
import { ReleaseProgressWriter } from "./services/release-reconciliation/ReleaseProgressWriter";
import { ReleaseReconciliationService } from "./services/release-reconciliation/ReleaseReconciliationService";
import { SEARCH_SERVICE_DEFINITIONS } from "./services/search/definitions";
import type { SearchRegistry } from "./services/search/SearchRegistry";
import { SearchRegistryImpl } from "./services/search/SearchRegistry";
import { searchTitles } from "./services/search/SearchRoutingService";
import { AniListAdapter } from "./services/sync/AniListAdapter";
import { SyncService } from "./services/sync/SyncService";
import { TmdbAdapter } from "./services/sync/TmdbAdapter";
import { BinaryAutoUpdater } from "./services/update/BinaryAutoUpdater";
import { readInstallManifest } from "./services/update/install-manifest";
import { detectInstallMethod } from "./services/update/install-method";
import { resolveLatestVersion } from "./services/update/resolve-latest-version";
import { UpdateService } from "./services/update/UpdateService";
import type { CapabilitySnapshot } from "./ui";

/**
 * The container is the single source of truth for all dependencies.
 * No service should import concrete implementations - only interfaces from here.
 */
export type ShellChrome = "default" | "minimal" | "quick";

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
  readonly configStore: ConfigStore;
  readonly cacheStore: CacheStore;
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

/**
 * Create the container with all services wired together.
 * This is called once at application startup.
 */
export async function createContainer(options?: ContainerOptions): Promise<Container> {
  const debug = options?.debug ?? false;
  initLogger(debug || process.env.KITSUNE_DEBUG === "1");

  // Core infrastructure first (no dependencies on other services)
  const logger = new StructuredLogger({
    debug,
    sanitize: (value) => redactDiagnosticValue(value, { homeDir: process.env.HOME }),
  });
  const sessionId = createCorrelationId("session");
  const tracer = new TracerImpl({
    logger,
    outputs: debug ? ["console", "file"] : [],
  });

  const storage = new FileStorage();
  const paths = getKunaiPaths();
  const dataDb = openKunaiDatabase(paths.dataDbPath);
  const cacheDb = openKunaiDatabase(paths.cacheDbPath);
  runMigrations(dataDb, "data");
  runMigrations(cacheDb, "cache");

  if (!isHistoryIdentityConsolidatorApplied(dataDb)) {
    runHistoryIdentityConsolidator(dataDb, {
      dryRun: process.env.KUNAI_HISTORY_IDENTITY_DRY_RUN === "1",
      log: debug ? (message) => logger.info(message) : undefined,
    });
    if (process.env.KUNAI_HISTORY_IDENTITY_DRY_RUN !== "1") {
      markHistoryIdentityConsolidatorApplied(dataDb);
    }
  }

  // Persistence layer
  const configStore = new ConfigStoreImpl(storage);
  const historyRepository = new HistoryRepository(dataDb);
  const cacheStore = new SqliteCacheStoreImpl(new StreamCacheRepository(cacheDb));
  const mediaTrackService = new MediaTrackService();
  const recommendationCache = new RecommendationCacheRepository(cacheDb);
  const providerHealth = new ProviderHealthRepository(cacheDb);
  const endpointHealth = new ProviderEndpointHealthService(
    new ProviderEndpointHealthRepository(cacheDb),
    () => new Date(),
    listDeprecatedVidkingEndpoints().map((endpoint) => ({
      providerId: "videasy",
      endpoint,
      failureClass: "route-dead" as const,
    })),
  );
  const titleProviderHealth = new TitleProviderHealthService(
    new TitleProviderHealthRepository(cacheDb),
  );
  const scheduleCache = new ScheduleCacheRepository(cacheDb);
  const providerTitleBridge = new ProviderTitleBridgeRepository(cacheDb);
  const titleBridgePort = createProviderTitleBridgePort(providerTitleBridge);
  const releaseProgressCache = new ReleaseProgressCacheRepository(cacheDb);
  const calendarArchive = new CalendarArchiveRepository(cacheDb);
  const diagnosticEvents = new DiagnosticEventsRepository(cacheDb);
  const downloadJobs = new DownloadJobsRepository(dataDb);
  const offlineAssets = new OfflineAssetsRepository(dataDb);
  const offlineTitlePolicies = new OfflineTitlePoliciesRepository(dataDb);
  const offlineMaintenanceJobs = new OfflineMaintenanceJobsRepository(dataDb);
  const listRepository = new ListRepository(dataDb);
  const queueRepository = new QueueRepository(dataDb);
  const notificationRepository = new NotificationRepository(dataDb);
  const followedTitleRepository = new FollowedTitleRepository(dataDb);
  const playlistsRepository = new PlaylistsRepository(dataDb);
  const diagnosticsStore = new DiagnosticsStoreImpl();
  const featureFlags = resolveAttentionFeatureFlags();
  const traceCategories = resolveTraceCategories({
    explicit: process.env.KUNAI_TRACE,
    debugSession: options?.debugSession,
  });
  const debugTracePath =
    options?.debugJson || options?.debugSession
      ? join(paths.dataDir, "traces", `kunai-trace-${Date.now()}.jsonl`)
      : undefined;
  const traceReporter = debugTracePath
    ? new DebugTraceReporter({
        filePath: debugTracePath,
        categories: traceCategories,
      })
    : undefined;
  const debugSessionInstructions =
    options?.debugSession && debugTracePath
      ? buildDebugSessionInstructions({
          tracePath: debugTracePath,
          categories: traceCategories,
        })
      : undefined;
  const diagnosticsService = new DiagnosticsServiceImpl({
    store: diagnosticsStore,
    logger,
    appVersion: options?.appVersion,
    debug,
    traceReporter,
    durableSink: new AsyncDurableDiagnosticsSink({
      repository: diagnosticEvents,
    } satisfies DurableDiagnosticsSinkOptions),
  });
  const sourceInventory = new SourceInventoryService(new SourceInventoryRepository(cacheDb), {
    diagnostics: diagnosticsService,
  });
  const episodePlaybackSelection = new EpisodePlaybackSelectionService(
    join(paths.configDir, "episode-playback-selections.json"),
  );
  const titlePlaybackSource = new TitlePlaybackSourceService(
    join(paths.configDir, "title-playback-sources.json"),
  );
  const videasyLazySourceProbe = new VideasyLazySourceProbeService({ sourceInventory });
  const storageMaintenance = new StorageMaintenanceService({
    dataDb,
    cacheDb,
    diagnostics: diagnosticsService,
  });

  // Lists, playlist, stats, sync
  const listService = new ListService(listRepository);
  const queueService = new QueueService(queueRepository, sessionId);
  const statsService = new StatsService(dataDb);
  const statsFormatter = new StatsFormatter();
  const syncTokenStore = new SyncTokenStore(paths);
  const anilistAdapter = new AniListAdapter(syncTokenStore);
  // Use the same bundled public TMDB key the rest of the app uses for metadata.
  // TMDB v3 uses a single key for both read and auth flows; no separate env var needed.
  // NOTE: this literal is NOT a secret — it is a public, rate-limited TMDB v3 read
  // key intended to be embedded in client apps. The fallback is deliberate (failing
  // closed here would break metadata for every user who never sets the env var).
  // Static scanners flag this as a "secret fallback"; that is a false positive.
  const TMDB_PUBLIC_KEY = process.env.KUNAI_TMDB_API_KEY ?? "653bb8af90162bd98fc7ee32bcbbfb3d";
  const tmdbAdapter = new TmdbAdapter(syncTokenStore, TMDB_PUBLIC_KEY);
  await Promise.all([anilistAdapter.init(), tmdbAdapter.init()]);
  const syncService = new SyncService(anilistAdapter, tmdbAdapter);

  // Load config
  const config = await ConfigServiceImpl.load(configStore);
  if (config.videasyAppIdMigratedOnLoad) {
    const { invalidateVideasyProviderCaches } = await import("@/app/videasy-cache-invalidation");
    await invalidateVideasyProviderCaches({
      cacheStore,
      sourceInventory,
      diagnostics: diagnosticsService,
      reason: "videasyAppId auto-migration",
    });
  }

  // Session state (pure, no external deps)
  const stateManager = new SessionStateManagerImpl({ logger });

  // Infrastructure services
  const shell = new ShellServiceImpl({ logger, tracer, stateManager });
  const playerControl = new PlayerControlServiceImpl({ logger, diagnostics: diagnosticsService });
  const workControl = new WorkControlServiceImpl({ logger, diagnostics: diagnosticsService });
  const playerPresentation: PlayerPresentationPort = {
    isInteractiveShellMounted: () => getRootContentSession() !== null,
  };
  const player = new PlayerServiceImpl({
    logger,
    tracer,
    diagnostics: diagnosticsService,
    playerControl,
    config,
    mpv: options?.mpv,
    presentation: playerPresentation,
  });
  const presence = new PresenceServiceImpl({ config, diagnostics: diagnosticsService });

  // Engine: single source of truth for provider resolution
  const providerPriority = createProviderPrioritySnapshot(config);
  const providerModules = orderProviderModulesByPriority(
    [
      videasyProviderModule,
      vidlinkProviderModule,
      rivestreamProviderModule,
      allmangaProviderModule,
      miruroProviderModule,
    ],
    providerPriority,
  );
  const relayRegistry = buildProviderRelayRegistry(providerModules);
  const createProviderFetchPort = (providerId: (typeof providerModules)[number]["providerId"]) =>
    createRelayFetchPort({
      providerId,
      registry: relayRegistry,
      relayConfig: config.getRaw().providerRelay,
      env: {
        baseUrl: process.env.KUNAI_RELAY_BASE_URL,
        token: process.env.KUNAI_RELAY_TOKEN,
      },
    });
  const engine = createProviderEngine({
    modules: providerModules,
    attemptTimeoutMs: resolveProviderAttemptTimeoutMs(config.startupPriority),
    fetch: createProviderFetchPort,
    endpointHealth,
    titleBridge: titleBridgePort,
    auth: {
      getSecret(providerId, key) {
        if (!isVideasyFamilyProvider(providerId)) return undefined;
        if (key === "videasySessionToken") {
          return (
            process.env.KUNAI_VIDEASY_SESSION_TOKEN?.trim() ||
            config.videasySessionToken.trim() ||
            undefined
          );
        }
        if (key === "videasyAppId") {
          return config.videasyAppId;
        }
        return undefined;
      },
    },
  });

  const providerRegistry = createProviderRegistry(engine, providerPriority);
  const streamHealthService = new StreamHealthService();
  const offlineAssetService = new OfflineAssetService(offlineAssets);
  const playbackResolveWork = new PlaybackResolveWorkService(
    new PlaybackResolveCoordinator({
      engine,
      cacheStore,
      providerHealth,
      streamHealthService,
      sourceInventory,
      titleProviderHealth,
      endpointHealth,
      titlePlaybackSource: titlePlaybackSource,
      diagnostics: diagnosticsService,
      getProviderPriority: () => createProviderPrioritySnapshot(config),
    }),
    {
      onCompletedLedger: (ledger) => diagnosticsService.recordResolveWorkLedger(ledger),
    },
  );
  const connectivity = new Connectivity(() => config.offlineMode);
  const notificationSinkRegistry = new NotificationSinkRegistry();
  notificationSinkRegistry.register(
    new LogNotificationSink((message, context) => {
      logger.debug(message, context);
    }),
  );
  notificationSinkRegistry.register(new OsNotificationSink());
  const notificationService = new NotificationService({
    repo: notificationRepository,
    getMutedTitleIds: () =>
      new Set(followedTitleRepository.listByPreference("muted").map((item) => item.titleId)),
    derivationFlags: {
      newEpisodeProjection: featureFlags.newEpisodeProjection,
      queueRecovery: featureFlags.queueRecovery,
    },
    sinks: {
      deliverActive: (records) => {
        for (const record of records) {
          notificationSinkRegistry.deliver(mapRecordToSinkDelivery(record));
        }
      },
      dismiss: (dedupKey) => {
        notificationSinkRegistry.dismiss(dedupKey);
      },
    },
  });

  const downloadService = new DownloadService({
    repo: downloadJobs,
    config,
    logger,
    ytDlpAvailable: options?.capabilitySnapshot?.ytDlp ?? false,
    ffprobeAvailable: Boolean(Bun.which("ffprobe")),
    diagnostics: diagnosticsService,
    onCompletedArtifact: (job) => {
      const asset = offlineAssetService.adoptCompletedJob(job);
      if (asset?.state !== "ready") return;
      notificationService.recordSignals(
        [
          {
            type: "download-complete",
            titleId: asset.titleId,
            mediaKind: asset.mediaKind,
            title: asset.titleName,
            season: asset.season,
            episode: asset.episode,
          },
        ],
        asset.updatedAt,
      );
    },
    onTerminalFailure: (job, error) => {
      notificationService.recordSignals([
        {
          type: "download-failed",
          titleId: job.titleId,
          mediaKind: job.mediaKind,
          title: job.titleName,
          season: job.season,
          episode: job.episode,
          error,
        },
      ]);
    },
    resolveDownloadStream: async (intent) => {
      const controller = new AbortController();
      const result = await playbackResolveWork.resolve(
        {
          title: intent.title,
          episode: intent.episode ?? { season: 1, episode: 1 },
          mode: intent.mode,
          providerId: intent.providerId,
          audioPreference: intent.audioPreference,
          subtitlePreference: intent.subtitlePreference,
          qualityPreference: intent.qualityPreference,
          startupPriority: "quality-first",
          selectedSourceId: intent.selectedSourceId,
          selectedStreamId: intent.selectedStreamId,
          favoriteSourceNames: config.favoriteSources,
          recoveryMode: config.recoveryMode,
          signal: controller.signal,
        },
        { intentKind: "download", budgetLane: "background" },
      );
      if (!result.stream) return null;
      const resolvedStreamId = result.stream.providerResolveResult?.selectedStreamId;
      const resolvedSourceId = result.stream.providerResolveResult?.streams.find(
        (candidate) => candidate.id === resolvedStreamId,
      )?.sourceId;
      return {
        stream: result.stream,
        providerId: result.providerId,
        selectionChanged:
          result.providerId !== intent.providerId ||
          (Boolean(intent.selectedStreamId) && resolvedStreamId !== intent.selectedStreamId) ||
          (Boolean(intent.selectedSourceId) && resolvedSourceId !== intent.selectedSourceId),
      };
    },
  });
  const offlineLibraryService = new OfflineLibraryService({
    downloadService,
    historyRepository,
    offlineAssetService,
  });
  const offlineMaintenanceService = new OfflineMaintenanceService({
    jobs: offlineMaintenanceJobs,
    assets: offlineAssetService,
    diagnostics: diagnosticsService,
  });
  const startupAt = new Date().toISOString();
  queueRepository.markActiveQueueSessionsRecoverable(sessionId, startupAt);
  queueRepository.createQueueSession({
    id: sessionId,
    status: "active",
    createdAt: startupAt,
    updatedAt: startupAt,
  });
  // Queue-recovery is ephemeral: refresh it each startup so exactly one notification
  // points at the latest recoverable queue (the one the restore action targets),
  // instead of one accumulating per startup. Clearing first also cleans up any
  // stale per-session notices from older builds.
  notificationService.deleteByKind("queue-recovery");
  const latestRecoverableSession = queueRepository.listRecoverableQueueSessions()[0];
  if (latestRecoverableSession) {
    notificationService.recordSignals(
      [
        {
          type: "queue-recoverable" as const,
          queueSessionId: latestRecoverableSession.id,
          itemCount: latestRecoverableSession.itemCount,
          updatedAt: latestRecoverableSession.updatedAt,
        },
      ],
      startupAt,
    );
  }
  const continuationProjectionService = new ContinuationProjectionService();
  const continueWatchingService = new ContinueWatchingService(historyRepository);
  const attentionRefreshWorker = new AttentionRefreshWorker({
    flags: featureFlags,
    diagnostics: diagnosticsService,
  });
  const backgroundWorkScheduler = new BackgroundWorkScheduler({ maxConcurrent: 2 });
  const durablePlaylistService = new DurablePlaylistService(playlistsRepository);

  const searchRegistry = new SearchRegistryImpl({ logger, tracer }, SEARCH_SERVICE_DEFINITIONS);

  const shellChrome: ShellChrome = options?.shellChrome ?? "default";
  const capabilitySnapshot = options?.capabilitySnapshot ?? null;

  const recommendationService = new RecommendationServiceImpl(recommendationCache);
  const catalogScheduleService = createCatalogScheduleService(scheduleCache);
  const releaseProgressWriter = new ReleaseProgressWriter(releaseProgressCache);
  const releaseReconciliationService = new ReleaseReconciliationService({
    repository: releaseProgressCache,
    writer: releaseProgressWriter,
    loadProgress: (candidates, signal) =>
      loadCatalogProgress(catalogScheduleService, candidates, signal),
  });
  const offlineRunwayService = new OfflineRunwayService({
    policies: offlineTitlePolicies,
    assets: offlineAssetService,
    historyRepository,
    releaseProgressCache,
    downloadService,
    scheduler: backgroundWorkScheduler,
    diagnostics: diagnosticsService,
    isPowerSaver: () => config.powerSaverMode,
  });
  const timelineService = new TimelineService(catalogScheduleService);
  const resultEnrichmentService = new ResultEnrichmentService({
    historyRepository,
    offlineLibraryService,
    continueWatchingService,
    getCachedNextRelease: (result) =>
      result.id.startsWith("anilist:")
        ? catalogScheduleService.peekNextRelease("anilist", result.id)
        : null,
    ttlMs: 5 * 60 * 1000,
  });
  const historyCatalogEpisodeCounts = new Map<string, number>();
  const historyMetadataHealer = new HistoryMetadataHealer({
    repo: historyRepository,
    resolver: createHistoryMetadataResolver({
      search: async (title, mediaKind) => {
        const mode = mediaKind === "anime" ? "anime" : "series";
        try {
          const { results } = await searchTitles(title, {
            mode,
            providerId: mode === "anime" ? config.animeProvider : config.provider,
            animeLanguageProfile: config.animeLanguageProfile,
            searchRegistry,
            providerRegistry,
            enrichAnimeMetadata: false,
          });
          return results;
        } catch (error) {
          logger.warn("History metadata search failed", { title, error });
          return [];
        }
      },
    }),
    onHealError: (titleId, error) =>
      logger.warn("History metadata heal failed", { titleId, error }),
  });
  const detectedInstall = detectInstallMethod({
    cwd: process.cwd(),
    entrypoint: process.argv[1],
    fileExists: existsSync,
  });
  const updateService = new UpdateService({
    config,
    diagnostics: diagnosticsService,
    currentVersion: options?.appVersion ?? "0.0.0",
    installMethod: detectedInstall,
    fetchLatestVersion: async () => {
      const manifest = await readInstallManifest();
      const channel = manifest?.channel ?? detectedInstall.kind;
      const version = await resolveLatestVersion(channel);
      if (!version) throw new Error("Could not resolve latest version");
      return version;
    },
  });
  const binaryAutoUpdater = new BinaryAutoUpdater({
    config,
    currentVersion: options?.appVersion ?? "0.0.0",
  });

  const container: Container = {
    logger,
    tracer,
    sessionId,
    config,
    engine,
    providerRegistry,
    searchRegistry,
    shell,
    player,
    playerControl,
    workControl,
    storage,
    historyRepository,
    configStore,
    cacheStore,
    diagnosticsStore,
    diagnosticsService,
    storageMaintenance,
    sourceInventory,
    episodePlaybackSelection,
    titlePlaybackSource,
    videasyLazySourceProbe,
    playbackResolveWork,
    mediaTrackService,
    featureFlags,
    providerHealth,
    endpointHealth,
    titleProviderHealth,
    downloadService,
    offlineAssetService,
    offlineTitlePolicies,
    offlineMaintenanceJobs,
    offlineLibraryService,
    offlineMaintenanceService,
    offlineRunwayService,
    notificationService,
    connectivity,
    presence,
    stateManager,
    recommendationService,
    catalogScheduleService,
    releaseProgressCache,
    releaseProgressWriter,
    calendarArchive,
    releaseReconciliationService,
    timelineService,
    resultEnrichmentService,
    historyMetadataHealer,
    historyCatalogEpisodeCounts,
    updateService,
    binaryAutoUpdater,
    listRepository,
    queueRepository,
    notificationRepository,
    followedTitleRepository,
    playlistsRepository,
    durablePlaylistService,
    listService,
    queueService,
    statsService,
    statsFormatter,
    syncTokenStore,
    syncService,
    continuationProjectionService,
    continueWatchingService,
    attentionRefreshWorker,
    backgroundWorkScheduler,
    shellChrome,
    capabilitySnapshot,
    debugTracePath,
    debugSessionInstructions,
  };

  logger.info("Container initialized", {
    providers: engine.getProviderIds(),
    searchServices: searchRegistry.getAllIds(),
    capabilityIssues: capabilitySnapshot?.issues.length ?? 0,
  });

  return container;
}
