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
  getKunaiPaths,
  HistoryRepository,
  openKunaiDatabase,
  ProviderHealthRepository,
  RecommendationCacheRepository,
  runMigrations,
  ScheduleCacheRepository,
  SourceInventoryRepository,
  StreamCacheRepository,
} from "@kunai/storage";

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
import {
  createCatalogScheduleService,
  type CatalogScheduleService,
} from "./services/catalog/CatalogScheduleService";
import { ResultEnrichmentService } from "./services/catalog/ResultEnrichmentService";
import { TimelineService } from "./services/catalog/TimelineService";
import {
  DebugTraceReporter,
  parseTraceCategories,
} from "./services/diagnostics/DebugTraceReporter";
import type { DiagnosticsService } from "./services/diagnostics/DiagnosticsService";
import { DiagnosticsServiceImpl } from "./services/diagnostics/DiagnosticsServiceImpl";
import type { DiagnosticsStore } from "./services/diagnostics/DiagnosticsStore";
import { DiagnosticsStoreImpl } from "./services/diagnostics/DiagnosticsStoreImpl";
import { DownloadService } from "./services/download/DownloadService";
import { OfflineLibraryService } from "./services/offline/OfflineLibraryService";
import type { CacheStore } from "./services/persistence/CacheStore";
import type { ConfigService } from "./services/persistence/ConfigService";
import { ConfigServiceImpl } from "./services/persistence/ConfigServiceImpl";
import type { ConfigStore } from "./services/persistence/ConfigStore";
import { ConfigStoreImpl } from "./services/persistence/ConfigStoreImpl";
import type { HistoryStore } from "./services/persistence/HistoryStore";
import { SqliteCacheStoreImpl } from "./services/persistence/SqliteCacheStoreImpl";
import { SqliteHistoryStoreImpl } from "./services/persistence/SqliteHistoryStoreImpl";
import { MediaTrackService } from "./services/playback/MediaTrackService";
import { PlaybackResolveCoordinator } from "./services/playback/PlaybackResolveCoordinator";
import { SourceInventoryService } from "./services/playback/SourceInventoryService";
import type { PresenceService } from "./services/presence/PresenceService";
import { PresenceServiceImpl } from "./services/presence/PresenceServiceImpl";
import type { ProviderRegistry } from "./services/providers/ProviderRegistry";
import { createProviderRegistry } from "./services/providers/ProviderRegistry";
import type { RecommendationService } from "./services/recommendations/RecommendationService";
import { RecommendationServiceImpl } from "./services/recommendations/RecommendationServiceImpl";
import { SEARCH_SERVICE_DEFINITIONS } from "./services/search/definitions";
import type { SearchRegistry } from "./services/search/SearchRegistry";
import { SearchRegistryImpl } from "./services/search/SearchRegistry";
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
  readonly configStore: ConfigStore;
  readonly cacheStore: CacheStore;
  readonly diagnosticsStore: DiagnosticsStore;
  readonly diagnosticsService: DiagnosticsService;
  readonly sourceInventory: SourceInventoryService;
  readonly mediaTrackService: MediaTrackService;
  readonly providerHealth: ProviderHealthRepository;
  readonly downloadService: DownloadService;
  readonly offlineLibraryService: OfflineLibraryService;
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

  /** CLI-driven shell density; minimal forces a minimal footer regardless of saved config. */
  readonly shellChrome: ShellChrome;
  /** Startup capability checks captured before container bootstrap. */
  readonly capabilitySnapshot: CapabilitySnapshot | null;
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
  const historyStore = new SqliteHistoryStoreImpl(new HistoryRepository(dataDb));
  const cacheStore = new SqliteCacheStoreImpl(new StreamCacheRepository(cacheDb));
  const sourceInventory = new SourceInventoryService(new SourceInventoryRepository(cacheDb));
  const mediaTrackService = new MediaTrackService();
  const recommendationCache = new RecommendationCacheRepository(cacheDb);
  const providerHealth = new ProviderHealthRepository(cacheDb);
  const scheduleCache = new ScheduleCacheRepository(cacheDb);
  const downloadJobs = new DownloadJobsRepository(dataDb);
  const diagnosticsStore = new DiagnosticsStoreImpl();
  const traceReporter = options?.debugJson
    ? new DebugTraceReporter({
        filePath: join(paths.dataDir, "traces", `kunai-trace-${Date.now()}.jsonl`),
        categories: parseTraceCategories(process.env.KUNAI_TRACE),
      })
    : undefined;
  const diagnosticsService = new DiagnosticsServiceImpl({
    store: diagnosticsStore,
    logger,
    appVersion: options?.appVersion,
    debug,
    traceReporter,
  });

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

  const searchRegistry = new SearchRegistryImpl({ logger, tracer }, SEARCH_SERVICE_DEFINITIONS);

  const shellChrome: ShellChrome = options?.shellChrome ?? "default";
  const capabilitySnapshot = options?.capabilitySnapshot ?? null;

  const recommendationService = new RecommendationServiceImpl(recommendationCache);
  const catalogScheduleService = createCatalogScheduleService(scheduleCache);
  const timelineService = new TimelineService(catalogScheduleService);
  const resultEnrichmentService = new ResultEnrichmentService({
    historyStore,
    offlineLibraryService,
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
    configStore,
    cacheStore,
    diagnosticsStore,
    diagnosticsService,
    sourceInventory,
    mediaTrackService,
    providerHealth,
    downloadService,
    offlineLibraryService,
    presence,
    stateManager,
    recommendationService,
    catalogScheduleService,
    timelineService,
    resultEnrichmentService,
    updateService,
    shellChrome,
    capabilitySnapshot,
  };

  logger.info("Container initialized", {
    providers: engine.getProviderIds(),
    searchServices: searchRegistry.getAllIds(),
    capabilityIssues: capabilitySnapshot?.issues.length ?? 0,
  });

  return container;
}
