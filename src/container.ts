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
import type { StorageService } from "./infra/storage/StorageService";
import type { HistoryStore } from "./services/persistence/HistoryStore";
import type { ConfigStore } from "./services/persistence/ConfigStore";
import type { CacheStore } from "./services/persistence/CacheStore";
import type { SessionStateManager } from "./domain/session/SessionStateManager";

// Import implementations
import { StructuredLogger } from "./infra/logger/StructuredLogger";
import { TracerImpl } from "./infra/tracer/TracerImpl";
import { FileStorage } from "./infra/storage/FileStorage";
import { ConfigServiceImpl } from "./services/persistence/ConfigServiceImpl";
import { ConfigStoreImpl } from "./services/persistence/ConfigStoreImpl";
import { HistoryStoreImpl } from "./services/persistence/HistoryStoreImpl";
import { CacheStoreImpl } from "./services/persistence/CacheStoreImpl";
import { SessionStateManagerImpl } from "./domain/session/SessionStateManager";
import { ShellServiceImpl } from "./infra/shell/ShellServiceImpl";
import { BrowserServiceImpl } from "./infra/browser/BrowserServiceImpl";
import { PlayerServiceImpl } from "./infra/player/PlayerServiceImpl";
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
  readonly storage: StorageService;

  // Persistence stores
  readonly historyStore: HistoryStore;
  readonly configStore: ConfigStore;
  readonly cacheStore: CacheStore;

  // Session
  readonly stateManager: SessionStateManager;
}

/**
 * Partial container for services that only need a subset of dependencies.
 * Use this for service constructors to declare minimal dependencies.
 */
export type ContainerDeps<T extends keyof Container> = Pick<Container, T>;

/**
 * Create the container with all services wired together.
 * This is called once at application startup.
 */
export async function createContainer(): Promise<Container> {
  // Core infrastructure first (no dependencies on other services)
  const logger = new StructuredLogger();
  const tracer = new TracerImpl({
    logger,
    outputs: ["console", "file"],
  });

  const storage = new FileStorage();

  // Persistence layer
  const configStore = new ConfigStoreImpl(storage);
  const historyStore = new HistoryStoreImpl(storage);
  const cacheStore = new CacheStoreImpl(storage);

  // Load config
  const config = await ConfigServiceImpl.load(configStore);

  // Session state (pure, no external deps)
  const stateManager = new SessionStateManagerImpl({ logger });

  // Infrastructure services
  const shell = new ShellServiceImpl({ logger, tracer, stateManager });
  const browser = new BrowserServiceImpl({ logger, tracer, config });
  const player = new PlayerServiceImpl({ logger, tracer });

  // Registries (depend on infrastructure)
  const providerRegistry = new ProviderRegistryImpl(
    { browser, logger, tracer, config },
    PROVIDER_DEFINITIONS,
  );

  const searchRegistry = new SearchRegistryImpl(
    { logger, tracer },
    SEARCH_SERVICE_DEFINITIONS,
  );

  const container: Container = {
    logger,
    tracer,
    config,
    providerRegistry,
    searchRegistry,
    shell,
    browser,
    player,
    storage,
    historyStore,
    configStore,
    cacheStore,
    stateManager,
  };

  logger.info("Container initialized", {
    providers: providerRegistry.getAllIds(),
    searchServices: searchRegistry.getAllIds(),
  });

  return container;
}
