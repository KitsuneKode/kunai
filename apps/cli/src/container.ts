// =============================================================================
// Dependency Injection Container
//
// Simple DI without external libraries. Services receive the container
// and destructure only what they need.
// =============================================================================

import { existsSync } from "node:fs";
import { join } from "node:path";

import { initLogger } from "@/logger";
import { createProviderEngine, type ProviderEngine } from "@kunai/core";
import {
  allmangaProviderModule,
  miruroProviderModule,
  rivestreamProviderModule,
  vidkingProviderModule,
} from "@kunai/providers";
import {
  DownloadJobsRepository,
  FollowedTitleRepository,
  getKunaiPaths,
  HistoryRepository,
  ListRepository,
  NotificationRepository,
  openKunaiDatabase,
  PlaylistRepository,
  PlaylistsRepository,
  ProviderHealthRepository,
  RecommendationCacheRepository,
  runMigrations,
  ScheduleCacheRepository,
  SourceInventoryRepository,
  StreamCacheRepository,
} from "@kunai/storage";

import {
  resolveAttentionFeatureFlags,
  type AttentionFeatureFlags,
} from "./domain/features/feature-flags";
import { ListService } from "./domain/lists/ListService";
import { PlaylistService } from "./domain/lists/PlaylistService";
import { StatsFormatter } from "./domain/lists/StatsFormatter";
import { StatsService } from "./domain/lists/StatsService";
import type { SessionStateManager } from "./domain/session/SessionStateManager";
import { SessionStateManagerImpl } from "./domain/session/SessionStateManager";
import type { Logger } from "./infra/logger/Logger";
// Import implementations
import { StructuredLogger } from "./infra/logger/StructuredLogger";
import type { MpvRuntimeOptions } from "./infra/player/mpv-runtime-options";
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
import { DownloadService } from "./services/download/DownloadService";
import { NotificationService } from "./services/notifications/NotificationService";
import { OfflineLibraryService } from "./services/offline/OfflineLibraryService";
import type { CacheStore } from "./services/persistence/CacheStore";
import type { ConfigService } from "./services/persistence/ConfigService";
import { ConfigServiceImpl } from "./services/persistence/ConfigServiceImpl";
import type { ConfigStore } from "./services/persistence/ConfigStore";
import { ConfigStoreImpl } from "./services/persistence/ConfigStoreImpl";
import type { HistoryStore } from "./services/persistence/HistoryStore";
import { SqliteCacheStoreImpl } from "./services/persistence/SqliteCacheStoreImpl";
import { SqliteHistoryStoreImpl } from "./services/persistence/SqliteHistoryStoreImpl";
import { StorageMaintenanceService } from "./services/persistence/StorageMaintenanceService";
import { SyncTokenStore } from "./services/persistence/SyncTokenStore";
import { MediaTrackService } from "./services/playback/MediaTrackService";
import { PlaybackResolveCoordinator } from "./services/playback/PlaybackResolveCoordinator";
import { SourceInventoryService } from "./services/playback/SourceInventoryService";
import { DurablePlaylistService } from "./services/playlists/DurablePlaylistService";
import type { PresenceService } from "./services/presence/PresenceService";
import { PresenceServiceImpl } from "./services/presence/PresenceServiceImpl";
import type { ProviderRegistry } from "./services/providers/ProviderRegistry";
import { createProviderRegistry } from "./services/providers/ProviderRegistry";
import type { RecommendationService } from "./services/recommendations/RecommendationService";
import { RecommendationServiceImpl } from "./services/recommendations/RecommendationServiceImpl";
import { SEARCH_SERVICE_DEFINITIONS } from "./services/search/definitions";
import type { SearchRegistry } from "./services/search/SearchRegistry";
import { SearchRegistryImpl } from "./services/search/SearchRegistry";
import { AniListAdapter } from "./services/sync/AniListAdapter";
import { SyncService } from "./services/sync/SyncService";
import { TmdbAdapter } from "./services/sync/TmdbAdapter";
import { detectInstallMethod } from "./services/update/install-method";
import { fetchLatestKunaiVersion, UpdateService } from "./services/update/UpdateService";
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
  readonly historyStore: HistoryStore;
  /** Raw SQLite repository — use when you need HistoryProgress directly (no adapter mapping). */
  readonly historyRepository: HistoryRepository;
  readonly configStore: ConfigStore;
  readonly cacheStore: CacheStore;
  readonly diagnosticsStore: DiagnosticsStore;
  readonly diagnosticsService: DiagnosticsService;
  readonly storageMaintenance: StorageMaintenanceService;
  readonly sourceInventory: SourceInventoryService;
  readonly mediaTrackService: MediaTrackService;
  readonly featureFlags: AttentionFeatureFlags;
  readonly providerHealth: ProviderHealthRepository;
  readonly downloadService: DownloadService;
  readonly offlineLibraryService: OfflineLibraryService;
  readonly notificationService: NotificationService;
  readonly presence: PresenceService;

  // Session
  readonly stateManager: SessionStateManager;

  // Recommendations
  readonly recommendationService: RecommendationService;

  // Schedule/release tracking
  readonly catalogScheduleService: CatalogScheduleService;
  readonly timelineService: TimelineService;
  readonly resultEnrichmentService: ResultEnrichmentService;
  readonly updateService: UpdateService;

  // Lists, playlist, stats, and sync
  readonly listRepository: ListRepository;
  readonly playlistRepository: PlaylistRepository;
  readonly notificationRepository: NotificationRepository;
  readonly followedTitleRepository: FollowedTitleRepository;
  readonly playlistsRepository: PlaylistsRepository;
  readonly durablePlaylistService: DurablePlaylistService;
  readonly listService: ListService;
  readonly playlistService: PlaylistService;
  readonly statsService: StatsService;
  readonly statsFormatter: StatsFormatter;
  readonly syncTokenStore: SyncTokenStore;
  readonly syncService: SyncService;
  readonly continuationProjectionService: ContinuationProjectionService;
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
  const logger = new StructuredLogger({ debug });
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

  // Persistence layer
  const configStore = new ConfigStoreImpl(storage);
  const historyRepository = new HistoryRepository(dataDb);
  const historyStore = new SqliteHistoryStoreImpl(historyRepository);
  const cacheStore = new SqliteCacheStoreImpl(new StreamCacheRepository(cacheDb));
  const mediaTrackService = new MediaTrackService();
  const recommendationCache = new RecommendationCacheRepository(cacheDb);
  const providerHealth = new ProviderHealthRepository(cacheDb);
  const scheduleCache = new ScheduleCacheRepository(cacheDb);
  const downloadJobs = new DownloadJobsRepository(dataDb);
  const listRepository = new ListRepository(dataDb);
  const playlistRepository = new PlaylistRepository(dataDb);
  const notificationRepository = new NotificationRepository(dataDb);
  const followedTitleRepository = new FollowedTitleRepository(dataDb);
  const playlistsRepository = new PlaylistsRepository(dataDb);
  const diagnosticsStore = new DiagnosticsStoreImpl();
  const sourceInventory = new SourceInventoryService(new SourceInventoryRepository(cacheDb), {
    diagnosticsStore,
  });
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
  });
  const storageMaintenance = new StorageMaintenanceService({
    dataDb,
    cacheDb,
    diagnosticsStore,
  });

  // Lists, playlist, stats, sync
  const listService = new ListService(listRepository);
  const playlistService = new PlaylistService(playlistRepository, sessionId);
  const statsService = new StatsService(dataDb);
  const statsFormatter = new StatsFormatter();
  const syncTokenStore = new SyncTokenStore(paths);
  const anilistAdapter = new AniListAdapter(syncTokenStore);
  // Use the same bundled public TMDB key the rest of the app uses for metadata.
  // TMDB v3 uses a single key for both read and auth flows; no separate env var needed.
  const TMDB_PUBLIC_KEY = process.env.KUNAI_TMDB_API_KEY ?? "653bb8af90162bd98fc7ee32bcbbfb3d";
  const tmdbAdapter = new TmdbAdapter(syncTokenStore, TMDB_PUBLIC_KEY);
  await Promise.all([anilistAdapter.init(), tmdbAdapter.init()]);
  const syncService = new SyncService(anilistAdapter, tmdbAdapter);

  // Load config
  const config = await ConfigServiceImpl.load(configStore);

  // Session state (pure, no external deps)
  const stateManager = new SessionStateManagerImpl({ logger });

  // Infrastructure services
  const shell = new ShellServiceImpl({ logger, tracer, stateManager });
  const playerControl = new PlayerControlServiceImpl({ logger, diagnosticsStore });
  const workControl = new WorkControlServiceImpl({ logger, diagnosticsStore });
  const player = new PlayerServiceImpl({
    logger,
    tracer,
    diagnosticsStore,
    playerControl,
    config,
    mpv: options?.mpv,
  });
  const presence = new PresenceServiceImpl({ config, diagnosticsStore });

  // Engine: single source of truth for provider resolution
  const engine = createProviderEngine({
    modules: [
      miruroProviderModule,
      rivestreamProviderModule,
      vidkingProviderModule,
      allmangaProviderModule,
    ],
  });

  const providerRegistry = createProviderRegistry(engine);

  const downloadService = new DownloadService({
    repo: downloadJobs,
    config,
    logger,
    ytDlpAvailable: options?.capabilitySnapshot?.ytDlp ?? false,
    ffprobeAvailable: Boolean(Bun.which("ffprobe")),
    ffmpegAvailable: Boolean(Bun.which("ffmpeg")),
    diagnosticsStore,
    resolveDownloadStream: async (intent) => {
      const resolver = new PlaybackResolveCoordinator({
        engine,
        cacheStore,
        providerHealth,
        diagnostics: diagnosticsService,
      });
      const controller = new AbortController();
      const result = await resolver.resolve({
        title: intent.title,
        episode: intent.episode ?? { season: 1, episode: 1 },
        mode: intent.mode,
        providerId: intent.providerId,
        audioPreference: intent.audioPreference,
        subtitlePreference: intent.subtitlePreference,
        qualityPreference: intent.qualityPreference,
        recoveryMode: config.recoveryMode,
        signal: controller.signal,
      });
      if (!result.stream) return null;
      return {
        stream: result.stream,
        providerId: result.providerId,
        selectionChanged: result.providerId !== intent.providerId,
      };
    },
  });
  const offlineLibraryService = new OfflineLibraryService({
    downloadService,
    historyStore,
  });
  const notificationService = new NotificationService({
    repo: notificationRepository,
    getMutedTitleIds: () =>
      new Set(followedTitleRepository.listByPreference("muted").map((item) => item.titleId)),
  });
  const startupAt = new Date().toISOString();
  playlistRepository.markActiveQueueSessionsRecoverable(sessionId, startupAt);
  playlistRepository.createQueueSession({
    id: sessionId,
    status: "active",
    createdAt: startupAt,
    updatedAt: startupAt,
  });
  notificationService.recordSignals(
    playlistRepository.listRecoverableQueueSessions().map((queueSession) => ({
      type: "queue-recoverable" as const,
      queueSessionId: queueSession.id,
      itemCount: queueSession.itemCount,
      updatedAt: queueSession.updatedAt,
    })),
    startupAt,
  );
  const continuationProjectionService = new ContinuationProjectionService();
  const attentionRefreshWorker = new AttentionRefreshWorker({
    flags: featureFlags,
    diagnostics: diagnosticsStore,
  });
  const backgroundWorkScheduler = new BackgroundWorkScheduler({ maxConcurrent: 2 });
  const durablePlaylistService = new DurablePlaylistService(playlistsRepository);

  const searchRegistry = new SearchRegistryImpl({ logger, tracer }, SEARCH_SERVICE_DEFINITIONS);

  const shellChrome: ShellChrome = options?.shellChrome ?? "default";
  const capabilitySnapshot = options?.capabilitySnapshot ?? null;

  const recommendationService = new RecommendationServiceImpl(recommendationCache);
  const catalogScheduleService = createCatalogScheduleService(scheduleCache);
  const timelineService = new TimelineService(catalogScheduleService);
  const resultEnrichmentService = new ResultEnrichmentService({
    historyStore,
    offlineLibraryService,
    getCachedNextRelease: (result) =>
      result.id.startsWith("anilist:")
        ? catalogScheduleService.peekNextRelease("anilist", result.id)
        : null,
    ttlMs: 5 * 60 * 1000,
  });
  const updateService = new UpdateService({
    config,
    diagnostics: diagnosticsStore,
    currentVersion: options?.appVersion ?? "0.0.0",
    installMethod: detectInstallMethod({
      cwd: process.cwd(),
      entrypoint: process.argv[1],
      fileExists: existsSync,
    }),
    fetchLatestVersion: fetchLatestKunaiVersion,
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
    historyStore,
    historyRepository,
    configStore,
    cacheStore,
    diagnosticsStore,
    diagnosticsService,
    storageMaintenance,
    sourceInventory,
    mediaTrackService,
    featureFlags,
    providerHealth,
    downloadService,
    offlineLibraryService,
    notificationService,
    presence,
    stateManager,
    recommendationService,
    catalogScheduleService,
    timelineService,
    resultEnrichmentService,
    updateService,
    listRepository,
    playlistRepository,
    notificationRepository,
    followedTitleRepository,
    playlistsRepository,
    durablePlaylistService,
    listService,
    playlistService,
    statsService,
    statsFormatter,
    syncTokenStore,
    syncService,
    continuationProjectionService,
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
