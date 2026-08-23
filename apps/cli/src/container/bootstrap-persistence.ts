import { join } from "node:path";

import { createProviderTitleBridgePort } from "@/infra/storage/provider-title-bridge-port";
import { initLogger } from "@/logger";
import { runHistoryIdentityConsolidator } from "@/services/history-metadata/HistoryIdentityConsolidator";
import { runHistoryWatchLedgerBackfill } from "@/services/history-metadata/HistoryWatchLedgerBackfill";
import { runOfflineAssetIdentityBackfill } from "@/services/offline/offline-asset-identity-backfill";
import {
  CalendarArchiveRepository,
  DiagnosticEventsRepository,
  CatalogCrosswalkRepository,
  DownloadJobsRepository,
  FollowedTitleRepository,
  getKunaiPaths,
  HistoryRepository,
  HistoryTitleAliasRepository,
  ListRepository,
  NotificationRepository,
  OfflineAssetsRepository,
  OfflineMaintenanceJobsRepository,
  OfflineTitlePoliciesRepository,
  openKunaiDatabaseWithCorruptionRecovery,
  PlaybackEventRepository,
  PlaylistsRepository,
  ProviderTitleBridgeRepository,
  ProviderEndpointHealthRepository,
  ProviderHealthRepository,
  QueueRepository,
  RecommendationCacheRepository,
  ReleaseProgressCacheRepository,
  runMigrations,
  isDataMigrationApplied,
  isHistoryIdentityConsolidatorApplied,
  isWatchLedgerBackfillApplied,
  markDataMigrationApplied,
  markHistoryIdentityConsolidatorApplied,
  markWatchLedgerBackfillApplied,
  ResolveTraceRepository,
  ScheduleCacheRepository,
  SourceInventoryRepository,
  StreamCacheRepository,
  SyncOutboxRepository,
  SyncReconciliationRepository,
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
import { redactDiagnosticValue, resolveRedactionHomeDir } from "../services/diagnostics/redaction";
import { ResolveTraceSink } from "../services/diagnostics/ResolveTraceSink";
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
import {
  resolveAniListAuth,
  resolveTmdbAuth,
  type SyncAuthAvailability,
} from "../services/sync/auth-contract";
import { SyncService } from "../services/sync/SyncService";
import { TmdbAdapter } from "../services/sync/TmdbAdapter";
import type { ContainerOptions } from "./types";

export type CoreInfra = {
  readonly logger: Logger;
  readonly tracer: Tracer;
  readonly sessionId: string;
  readonly debugCapabilities: DebugCapabilities;
};

export type DebugCapabilities = {
  readonly enabled: boolean;
  readonly file: boolean;
  readonly tracerOutputs: ("console" | "file")[];
};

export type CoreInfraRuntime = {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly workingDirectory?: string;
  readonly write?: (line: string) => unknown;
  readonly isInteractiveShellMounted?: () => boolean;
  readonly stderrIsTTY?: boolean;
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
  readonly historyTitleAliases: HistoryTitleAliasRepository;
  readonly catalogCrosswalk: CatalogCrosswalkRepository;
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
  readonly resolveTraceSink: ResolveTraceSink;
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
  readonly syncReconciliationRepository: SyncReconciliationRepository;
  readonly syncAuthAvailability: SyncAuthAvailability;
  readonly debugTracePath?: string;
  readonly debugSessionInstructions?: readonly string[];
};

export function resolveDebugCapabilities(
  cliDebug: boolean,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): DebugCapabilities {
  const environmentDebug = environment.KITSUNE_DEBUG === "1";
  const enabled = cliDebug || environmentDebug;
  return {
    enabled,
    file: cliDebug,
    tracerOutputs: cliDebug ? ["console", "file"] : environmentDebug ? ["console"] : [],
  };
}

export function bootstrapCoreInfra(
  options?: ContainerOptions,
  runtime: CoreInfraRuntime = {},
): CoreInfra {
  const debugCapabilities = resolveDebugCapabilities(
    options?.debug ?? false,
    runtime.environment ?? process.env,
  );
  const shellMounted = runtime.isInteractiveShellMounted ?? isInteractiveShellMounted;
  const stderrIsTTY = runtime.stderrIsTTY ?? process.stderr.isTTY === true;
  const logger = new StructuredLogger({
    debug: debugCapabilities.enabled,
    console: () => !shellMounted() || !stderrIsTTY,
    file: debugCapabilities.file
      ? join(runtime.workingDirectory ?? process.cwd(), "logs.txt")
      : undefined,
    write: runtime.write,
    sanitize: (value) => redactDiagnosticValue(value, { homeDir: resolveRedactionHomeDir() }),
  });
  initLogger(debugCapabilities.enabled, logger);
  const sessionId = createCorrelationId("session");
  const tracer = new TracerImpl({
    logger,
    outputs: debugCapabilities.tracerOutputs,
  });

  return { logger, tracer, sessionId, debugCapabilities };
}

export async function bootstrapPersistence(
  options: ContainerOptions | undefined,
  core: CoreInfra,
): Promise<PersistenceBootstrap> {
  const { logger, sessionId, debugCapabilities } = core;
  const debug = debugCapabilities.enabled;

  const storage = new FileStorage(undefined, (message, context) => logger.warn(message, context));
  const paths = getKunaiPaths();
  const dataOpen = openKunaiDatabaseWithCorruptionRecovery(paths.dataDbPath, {}, (message) =>
    logger.warn(message),
  );
  const dataDb = dataOpen.db;
  const cacheOpen = openKunaiDatabaseWithCorruptionRecovery(paths.cacheDbPath, {}, (message) =>
    logger.warn(message),
  );
  const cacheDb = cacheOpen.db;
  if (dataOpen.quarantinedCorruptDb && cacheOpen.quarantinedCorruptDb) {
    logger.warn(
      "Both database files were corrupt and have been quarantined; history and cache start empty. " +
        "The .corrupt.*.bak files next to the databases hold the old data.",
    );
  } else if (dataOpen.quarantinedCorruptDb) {
    logger.warn(
      "The data database was corrupt and has been quarantined; watch history starts empty. " +
        "The .corrupt.*.bak file next to it holds the old data.",
    );
  } else if (cacheOpen.quarantinedCorruptDb) {
    logger.warn(
      "The cache database was corrupt and has been quarantined; cached data refetches on demand. " +
        "The .corrupt.*.bak file next to it holds the old data.",
    );
  }
  runMigrations(dataDb, "data");
  runMigrations(cacheDb, "cache");

  // v2 adds anime content-class units (series rows with AniList/MAL ids move to
  // their AniList unit) and maintains the history_title_aliases index.
  const HISTORY_IDENTITY_CONSOLIDATOR_V2_ID = "history_identity_consolidator_v2";
  if (
    !isHistoryIdentityConsolidatorApplied(dataDb) ||
    !isDataMigrationApplied(dataDb, HISTORY_IDENTITY_CONSOLIDATOR_V2_ID)
  ) {
    runHistoryIdentityConsolidator(dataDb, {
      dryRun: process.env.KUNAI_HISTORY_IDENTITY_DRY_RUN === "1",
      log: debug ? (message) => logger.info(message) : undefined,
    });
    if (process.env.KUNAI_HISTORY_IDENTITY_DRY_RUN !== "1") {
      markHistoryIdentityConsolidatorApplied(dataDb);
      markDataMigrationApplied(dataDb, HISTORY_IDENTITY_CONSOLIDATOR_V2_ID);
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
  const historyTitleAliases = new HistoryTitleAliasRepository(dataDb);
  const catalogCrosswalk = new CatalogCrosswalkRepository(cacheDb);
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
  // Every bootstrap, not once behind a marker: an asset filed under a raw id
  // only becomes relocatable when history or another download teaches the alias
  // index the title's catalog ids, and that learning has no deadline.
  const offlineIdentityBackfill = runOfflineAssetIdentityBackfill(
    offlineAssets,
    historyTitleAliases,
  );
  if (debug && offlineIdentityBackfill.assetsRelocated > 0) {
    logger.info(
      `Offline identity backfill moved ${offlineIdentityBackfill.assetsRelocated} asset(s) across ${offlineIdentityBackfill.titlesRelocated} title(s)`,
    );
  }
  const offlineTitlePolicies = new OfflineTitlePoliciesRepository(dataDb);
  const offlineMaintenanceJobs = new OfflineMaintenanceJobsRepository(dataDb);
  const listRepository = new ListRepository(dataDb);
  const syncReconciliationRepository = new SyncReconciliationRepository(dataDb);
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
    sessionId,
    appVersion: options?.appVersion,
    debug,
    traceReporter,
    durableSink: new AsyncDurableDiagnosticsSink({
      repository: diagnosticEvents,
      onFailure: (failure) => {
        logger.warn("Diagnostics durable sink failed", {
          category: "runtime",
          operation: `diagnostics.durable.${failure.operation}.failed`,
          error: failure.message,
        });
      },
    } satisfies DurableDiagnosticsSinkOptions),
  });
  const sourceInventory = new SourceInventoryService(new SourceInventoryRepository(cacheDb), {
    diagnostics: diagnosticsService,
  });
  const resolveTraceSink = new ResolveTraceSink(new ResolveTraceRepository(cacheDb));
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

  // Sync is constructed after config loads: the drain reads live gates through
  // `SyncConfigPort` on every mutation, so it must close over the real config
  // service rather than a snapshot taken before it existed.
  // Auth is resolved once, here, and injected. Adapters and settings then read
  // the same decision instead of each interpreting the environment, which is
  // how a Connect button comes to be offered for a flow that cannot start.
  const anilistAuth = resolveAniListAuth();
  const tmdbAuth = resolveTmdbAuth();
  const syncAuthAvailability: SyncAuthAvailability = {
    anilist: anilistAuth.availability,
    tmdb: tmdbAuth.availability,
  };

  const syncTokenStore = new SyncTokenStore(paths);
  const anilistAdapter = new AniListAdapter(syncTokenStore, undefined, anilistAuth);
  const tmdbAdapter = new TmdbAdapter(syncTokenStore, tmdbAuth.apiKey ?? "");
  await Promise.all([anilistAdapter.init(), tmdbAdapter.init()]);
  const syncService = new SyncService({
    adapters: [anilistAdapter, tmdbAdapter],
    outbox: new SyncOutboxRepository(dataDb),
    config: { read: async () => ({ sync: config.getRaw().sync }) },
    diagnostics: diagnosticsService,
  });

  return {
    core,
    storage,
    paths,
    dataDb,
    cacheDb,
    config,
    configStore,
    historyRepository,
    historyTitleAliases,
    catalogCrosswalk,
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
    resolveTraceSink,
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
    syncReconciliationRepository,
    syncAuthAvailability,
    debugTracePath,
    debugSessionInstructions,
  };
}
