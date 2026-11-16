import { bindNetworkObserver } from "../services/network/network-observation";
import { bootstrapCoreInfra, bootstrapPersistence } from "./bootstrap-persistence";
import { bootstrapProviders } from "./bootstrap-providers";
import { bootstrapServices } from "./bootstrap-services";
import { type ContainerDisposeHandles, registerContainerDisposeHandles } from "./dispose-container";
import type { Container, ContainerOptions } from "./types";

/**
 * Create the container with all services wired together.
 * This is called once at application startup.
 */
export async function createContainer(options?: ContainerOptions): Promise<Container> {
  const core = bootstrapCoreInfra(options);
  const persistence = await bootstrapPersistence(options, core);
  const providers = await bootstrapProviders(persistence, options?.providerModulesOverride);
  const disposeHandles: ContainerDisposeHandles = {
    dataDb: persistence.dataDb,
    cacheDb: persistence.cacheDb,
    downloadResolveAbort: null,
  };
  const services = bootstrapServices({
    options,
    persistence,
    providers,
    disposeHandles,
  });

  const container: Container = {
    logger: core.logger,
    tracer: core.tracer,
    sessionId: core.sessionId,
    config: persistence.config,
    engine: providers.engine,
    providerRegistry: providers.providerRegistry,
    playbackResolveWork: providers.playbackResolveWork,
    ...services,
  };

  registerContainerDisposeHandles(container, disposeHandles);

  bindNetworkObserver(container);

  core.logger.info("Container initialized", {
    providers: providers.engine.getProviderIds(),
    searchServices: services.searchRegistry.getAllIds(),
    capabilityIssues: services.capabilitySnapshot?.issues.length ?? 0,
  });

  return container;
}

export { disposeContainer, abortOrphanDownloadResolve } from "./dispose-container";
export { effectiveFooterHints } from "./types";
export type { Container, ContainerDeps, ContainerOptions, ShellChrome } from "./types";
