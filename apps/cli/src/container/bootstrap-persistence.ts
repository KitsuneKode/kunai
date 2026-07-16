import { join } from "node:path";

import { createProviderTitleBridgePort } from "@/infra/storage/provider-title-bridge-port";
import { initLogger } from "@/logger";
import { runHistoryIdentityConsolidator } from "@/services/history-metadata/HistoryIdentityConsolidator";
import { runHistoryWatchLedgerBackfill } from "@/services/history-metadata/HistoryWatchLedgerBackfill";
import {
  CalendarArchiveRepository,
  DiagnosticEventsRepository,
  DownloadJobsRepository,
  FollowedTitleRepository,
  getKunaiPaths,
  HistoryRepository,
  ListRepository,
  NotificationRepository,
  OfflineAssetsRepository,
  OfflineMaintenanceJobsRepository,
  OfflineTitlePoliciesRepository,
  openKunaiDatabase,
  PlaybackEventRepository,
  PlaylistsRepository,
  ProviderTitleBridgeRepository,
  ProviderEndpointHealthRepository,
  ProviderHealthRepository,
  QueueRepository,
  RecommendationCacheRepository,
  ReleaseProgressCacheRepository,
  runMigrations,
  isHistoryIdentityConsolidatorApplied,
  isWatchLedgerBackfillApplied,
  markHistoryIdentityConsolidatorApplied,
  markWatchLedgerBackfillApplied,
  ScheduleCacheRepository,
  SourceInventoryRepository,
  StreamCacheRepository,
  TitleProviderHealthRepository,
  type KunaiDatabase,
} from "@kunai/storage";

import { isInteractiveShellMounted } from "../app-shell/interactive-shell-state";
import { resolveAttentionFeatureFlags } from "../domain/features/feature-flags";
import { ListService } from "../domain/lists/ListService";
import { StatsFormatter } from "../domain/lists/StatsFormatter";
import { StatsService } from "../domain/lists/StatsService";
import { QueueService } from "../domain/queue/QueueService";
import type { Logger } from "../infra/logger/Logger";
import { StructuredLogger } from "../infra/logger/StructuredLogger";
import { FileStorage } from "../infra/storage/FileStorage";
import type { Tracer } from "../infra/tracer/Tracer";
import { TracerImpl } from "../infra/tracer/TracerImpl";
import { createCorrelationId } from "../services/diagnostics/correlation";
import {
  buildDebugSessionInstructions,
  DebugTraceReporter,
  resolveTraceCategories,
} from "../services/diagnostics/DebugTraceReporter";
import { DiagnosticsServiceImpl } from "../services/diagnostics/DiagnosticsServiceImpl";
import { DiagnosticsStoreImpl } from "../services/diagnostics/DiagnosticsStoreImpl";
import {
  AsyncDurableDiagnosticsSink,
  type DurableDiagnosticsSinkOptions,
} from "../services/diagnostics/DurableDiagnosticsSink";
import { redactDiagnosticValue } from "../services/diagnostics/redaction";
import type { ConfigService } from "../services/persistence/ConfigService";
import { ConfigServiceImpl } from "../services/persistence/ConfigServiceImpl";
import { ConfigStoreImpl } from "../services/persistence/ConfigStoreImpl";
import { SqliteCacheStoreImpl } from "../services/persistence/SqliteCacheStoreImpl";
import { StorageMaintenanceService } from "../services/persistence/StorageMaintenanceService";
import { SyncTokenStore } from "../services/persistence/SyncTokenStore";
import { EpisodePlaybackSelectionService } from "../services/playback/EpisodePlaybackSelectionService";
import { MediaTrackService } from "../services/playback/MediaTrackService";
import { ProviderEndpointHealthService } from "../services/playback/ProviderEndpointHealthService";
import { SourceInventoryService } from "../services/playback/SourceInventoryService";
import { TitlePlaybackSourceService } from "../services/playback/TitlePlaybackSourceService";
import { TitleProviderHealthService } from "../services/playback/TitleProviderHealthService";
import { VideasyLazySourceProbeService } from "../services/playback/VideasyLazySourceProbeService";
import { AniListAdapter } from "../services/sync/AniListAdapter";
import { SyncService } from "../services/sync/SyncService";
import { TmdbAdapter } from "../services/sync/TmdbAdapter";
import type { ContainerOptions } from "./types";

export type CoreInfra = {
  readonly logger: Logger;
  readonly tracer: Tracer;
  readonly sessionId: string;
};

export type PersistenceBootstrap = {
  readonly core: CoreInfra;
  readonly storage: FileStorage;
  readonly paths: ReturnType<typeof getKunaiPaths>;
  readonly dataDb: KunaiDatabase;
  readonly cacheDb: KunaiDatabase;
  readonly config: ConfigService;
  readonly configStore: ConfigStoreImpl;
  readonly historyRepository: HistoryRepository;
  readonly playbackEventRepository: PlaybackEventRepository;
  readonly cacheStore: SqliteCacheStoreImpl;
  readonly mediaTrackService: MediaTrackService;
  readonly recommendationCache: RecommendationCacheRepository;
  readonly providerHealth: ProviderHealthRepository;
  readonly endpointHealth: ProviderEndpointHealthService;
  readonly titleProviderHealth: TitleProviderHealthService;
  readonly scheduleCache: ScheduleCacheRepository;
  readonly titleBridgePort: ReturnType<typeof createProviderTitleBridgePort>;
  readonly releaseProgressCache: ReleaseProgressCacheRepository;
  readonly calendarArchive: CalendarArchiveRepository;
  readonly downloadJobs: DownloadJobsRepository;
  readonly offlineAssets: OfflineAssetsRepository;
  readonly offlineTitlePolicies: OfflineTitlePoliciesRepository;
  readonly offlineMaintenanceJobs: OfflineMaintenanceJobsRepository;
  readonly listRepository: ListRepository;
  readonly queueRepository: QueueRepository;
  readonly notificationRepository: NotificationRepository;
  readonly followedTitleRepository: FollowedTitleRepository;
  readonly playlistsRepository: PlaylistsRepository;
  readonly diagnosticsStore: DiagnosticsStoreImpl;
  readonly featureFlags: ReturnType<typeof resolveAttentionFeatureFlags>;
  readonly diagnosticsService: DiagnosticsServiceImpl;
  readonly sourceInventory: SourceInventoryService;
  readonly episodePlaybackSelection: EpisodePlaybackSelectionService;
  readonly titlePlaybackSource: TitlePlaybackSourceService;
  readonly videasyLazySourceProbe: VideasyLazySourceProbeService;
  readonly storageMaintenance: StorageMaintenanceService;
  readonly listService: ListService;
  readonly queueService: QueueService;
  readonly statsService: StatsService;
  readonly statsFormatter: StatsFormatter;
  readonly syncTokenStore: SyncTokenStore;
  readonly syncService: SyncService;
  readonly debugTracePath?: string;
  readonly debugSessionInstructions?: readonly string[];
};

export function bootstrapCoreInfra(options?: ContainerOptions): CoreInfra {
  const debug = options?.debug ?? false;
  const logger = new StructuredLogger({
    debug,
    console: () => !isInteractiveShellMounted(),
    file: debug ? join(process.cwd(), "logs.txt") : undefined,
    sanitize: (value) => redactDiagnosticValue(value, { homeDir: process.env.HOME }),
  });
  initLogger(debug || process.env.KITSUNE_DEBUG === "1", logger);
  const sessionId = createCorrelationId("session");
  const tracer = new TracerImpl({
    logger,
    outputs: debug ? ["console", "file"] : [],
  });

  return { logger, tracer, sessionId };
}

export async function bootstrapPersistence(
  options: ContainerOptions | undefined,
  core: CoreInfra,
): Promise<PersistenceBootstrap> {
  const { logger, sessionId } = core;
  const debug = options?.debug ?? false;

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

  if (!isWatchLedgerBackfillApplied(dataDb)) {
    const stats = runHistoryWatchLedgerBackfill(dataDb);
    if (debug) {
      logger.info(`Watch ledger backfill updated ${stats.rowsUpdated} history rows`);
    }
    markWatchLedgerBackfillApplied(dataDb);
  }

  const configStore = new ConfigStoreImpl(storage);
  const historyRepository = new HistoryRepository(dataDb);
  const playbackEventRepository = new PlaybackEventRepository(dataDb);
  const cacheStore = new SqliteCacheStoreImpl(new StreamCacheRepository(cacheDb));
  const mediaTrackService = new MediaTrackService();
  const recommendationCache = new RecommendationCacheRepository(cacheDb);
  const providerHealth = new ProviderHealthRepository(cacheDb);
  const { listDeprecatedVidkingEndpoints } = await import("@kunai/providers/videasy");
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

  const listService = new ListService(listRepository);
  const queueService = new QueueService(queueRepository, sessionId);
  const statsService = new StatsService(dataDb);
  const statsFormatter = new StatsFormatter();
  const syncTokenStore = new SyncTokenStore(paths);
  const anilistAdapter = new AniListAdapter(syncTokenStore);
  const TMDB_PUBLIC_KEY = process.env.KUNAI_TMDB_API_KEY ?? "653bb8af90162bd98fc7ee32bcbbfb3d";
  const tmdbAdapter = new TmdbAdapter(syncTokenStore, TMDB_PUBLIC_KEY);
  await Promise.all([anilistAdapter.init(), tmdbAdapter.init()]);
  const syncService = new SyncService(anilistAdapter, tmdbAdapter);

  const config = await ConfigServiceImpl.load(configStore);
  if (config.videasyAppIdMigratedOnLoad) {
    const { invalidateVideasyProviderCaches } =
      await import("@/app/playback/videasy-cache-invalidation");
    await invalidateVideasyProviderCaches({
      cacheStore,
      sourceInventory,
      diagnostics: diagnosticsService,
      reason: "videasyAppId auto-migration",
    });
  }

  return {
    core,
    storage,
    paths,
    dataDb,
    cacheDb,
    config,
    configStore,
    historyRepository,
    playbackEventRepository,
    cacheStore,
    mediaTrackService,
    recommendationCache,
    providerHealth,
    endpointHealth,
    titleProviderHealth,
    scheduleCache,
    titleBridgePort,
    releaseProgressCache,
    calendarArchive,
    downloadJobs,
    offlineAssets,
    offlineTitlePolicies,
    offlineMaintenanceJobs,
    listRepository,
    queueRepository,
    notificationRepository,
    followedTitleRepository,
    playlistsRepository,
    diagnosticsStore,
    featureFlags,
    diagnosticsService,
    sourceInventory,
    episodePlaybackSelection,
    titlePlaybackSource,
    videasyLazySourceProbe,
    storageMaintenance,
    listService,
    queueService,
    statsService,
    statsFormatter,
    syncTokenStore,
    syncService,
    debugTracePath,
    debugSessionInstructions,
  };
}
