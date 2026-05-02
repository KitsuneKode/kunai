// =============================================================================
// Dependency Injection Container
//
// Simple DI without external libraries. Services receive the container
// and destructure only what they need.
// =============================================================================

import type { Logger } from "./infra/logger/Logger";
import type { Tracer } from "./infra/tracer/Tracer";
import type { ConfigService } from "./services/persistence/ConfigService";
import type { ProviderRegistry } from "./services/providers/ProviderRegistry";
import type { SearchRegistry } from "./services/search/SearchRegistry";
import type { ShellService } from "./infra/shell/ShellService";
import type { BrowserService } from "./infra/browser/BrowserService";
import type { PlayerService } from "./infra/player/PlayerService";
import type { PlayerControlService } from "./infra/player/PlayerControlService";
import type { StorageService } from "./infra/storage/StorageService";
import type { HistoryStore } from "./services/persistence/HistoryStore";
import type { ConfigStore } from "./services/persistence/ConfigStore";
import type { CacheStore } from "./services/persistence/CacheStore";
import type { DiagnosticsStore } from "./services/diagnostics/DiagnosticsStore";
import type { SessionStateManager } from "./domain/session/SessionStateManager";
import type { WorkControlService } from "./infra/work/WorkControlService";
import type { MpvRuntimeOptions } from "./infra/player/mpv-runtime-options";
import { initLogger } from "@/logger";
import {
  getKunaiPaths,
  HistoryRepository,
  openKunaiDatabase,
  runMigrations,
  StreamCacheRepository,
} from "@kunai/storage";

// Import implementations
import { StructuredLogger } from "./infra/logger/StructuredLogger";
import { TracerImpl } from "./infra/tracer/TracerImpl";
import { FileStorage } from "./infra/storage/FileStorage";
import { ConfigServiceImpl } from "./services/persistence/ConfigServiceImpl";
import { ConfigStoreImpl } from "./services/persistence/ConfigStoreImpl";
import { SqliteHistoryStoreImpl } from "./services/persistence/SqliteHistoryStoreImpl";
import { SqliteCacheStoreImpl } from "./services/persistence/SqliteCacheStoreImpl";
import { DiagnosticsStoreImpl } from "./services/diagnostics/DiagnosticsStoreImpl";
import { SessionStateManagerImpl } from "./domain/session/SessionStateManager";
import { WorkControlServiceImpl } from "./infra/work/WorkControlServiceImpl";
import { ShellServiceImpl } from "./infra/shell/ShellServiceImpl";
import { BrowserServiceImpl } from "./infra/browser/BrowserServiceImpl";
import { PlayerServiceImpl } from "./infra/player/PlayerServiceImpl";
import { PlayerControlServiceImpl } from "./infra/player/PlayerControlServiceImpl";
import { ProviderRegistryImpl } from "./services/providers/ProviderRegistry";
import { PROVIDER_DEFINITIONS } from "./services/providers/definitions";
import { SearchRegistryImpl } from "./services/search/SearchRegistry";
import { SEARCH_SERVICE_DEFINITIONS } from "./services/search/definitions";

/**
 * The container is the single source of truth for all dependencies.
 * No service should import concrete implementations - only interfaces from here.
 */
export interface Container {
  // Core services
  readonly logger: Logger;
  readonly tracer: Tracer;
  readonly config: ConfigService;

  // Registries
  readonly providerRegistry: ProviderRegistry;
  readonly searchRegistry: SearchRegistry;

  // Infrastructure
  readonly shell: ShellService;
  readonly browser: BrowserService;
  readonly player: PlayerService;
  readonly playerControl: PlayerControlService;
  readonly workControl: WorkControlService;
  readonly storage: StorageService;

  // Persistence stores
  readonly historyStore: HistoryStore;
  readonly configStore: ConfigStore;
  readonly cacheStore: CacheStore;
  readonly diagnosticsStore: DiagnosticsStore;

  // Session
  readonly stateManager: SessionStateManager;
}

/**
 * Partial container for services that only need a subset of dependencies.
 * Use this for service constructors to declare minimal dependencies.
 */
export type ContainerDeps<T extends keyof Container> = Pick<Container, T>;

export interface ContainerOptions {
  debug?: boolean;
  mpv?: MpvRuntimeOptions;
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
  const diagnosticsStore = new DiagnosticsStoreImpl();

  // Load config
  const config = await ConfigServiceImpl.load(configStore);

  // Session state (pure, no external deps)
  const stateManager = new SessionStateManagerImpl({ logger });

  // Infrastructure services
  const shell = new ShellServiceImpl({ logger, tracer, stateManager });
  const browser = new BrowserServiceImpl({ logger, tracer, config, cacheStore, diagnosticsStore });
  const playerControl = new PlayerControlServiceImpl({ logger, diagnosticsStore });
  const workControl = new WorkControlServiceImpl({ logger, diagnosticsStore });
  const player = new PlayerServiceImpl({
    logger,
    tracer,
    diagnosticsStore,
    playerControl,
    mpv: options?.mpv,
  });

  // Registries (depend on infrastructure)
  const providerRegistry = new ProviderRegistryImpl(
    { browser, logger, tracer, config },
    PROVIDER_DEFINITIONS,
  );

  const searchRegistry = new SearchRegistryImpl({ logger, tracer }, SEARCH_SERVICE_DEFINITIONS);

  const container: Container = {
    logger,
    tracer,
    config,
    providerRegistry,
    searchRegistry,
    shell,
    browser,
    player,
    playerControl,
    workControl,
    storage,
    historyStore,
    configStore,
    cacheStore,
    diagnosticsStore,
    stateManager,
  };

  logger.info("Container initialized", {
    providers: providerRegistry.getAllIds(),
    searchServices: searchRegistry.getAllIds(),
  });

  return container;
}
