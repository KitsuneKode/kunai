import type { KunaiDatabase } from "@kunai/storage";

import { bindNetworkObserver } from "../services/network/network-observation";
import type { Container } from "./types";

export type ContainerDisposeHandles = {
  readonly dataDb: KunaiDatabase;
  readonly cacheDb: KunaiDatabase;
  downloadResolveAbort: AbortController | null;
};

const disposeHandlesByContainer = new WeakMap<Container, ContainerDisposeHandles>();
const disposeInFlight = new WeakMap<Container, Promise<void>>();

export function registerContainerDisposeHandles(
  container: Container,
  handles: ContainerDisposeHandles,
): void {
  disposeHandlesByContainer.set(container, handles);
}

export function abortOrphanDownloadResolve(container: Container): void {
  disposeHandlesByContainer.get(container)?.downloadResolveAbort?.abort();
}

/**
 * Dispose the container exactly once: concurrent calls share one in-flight
 * promise, every step is failure-isolated (a throwing DB close must not skip
 * the next close), and the network observer is always unbound.
 */
export function disposeContainer(container: Container | null | undefined): Promise<void> {
  if (!container) return Promise.resolve();
  const inFlight = disposeInFlight.get(container);
  if (inFlight) return inFlight;
  const handles = disposeHandlesByContainer.get(container);
  if (!handles) return Promise.resolve();
  disposeHandlesByContainer.delete(container);

  const disposal = runDisposal(container, handles);
  disposeInFlight.set(container, disposal);
  return disposal;
}

async function runDisposal(container: Container, handles: ContainerDisposeHandles): Promise<void> {
  const bestEffort = async (run: () => void | Promise<void>): Promise<void> => {
    try {
      await run();
    } catch {
      // Best-effort teardown: later steps still run.
    }
  };

  try {
    await bestEffort(() => handles.downloadResolveAbort?.abort());
    await bestEffort(() => container.backgroundWorkScheduler.beginShutdown("container-dispose"));
    await bestEffort(async () => {
      await container.backgroundWorkScheduler.drain();
    });
    await bestEffort(() => container.diagnosticsService.flush());
    await bestEffort(() => handles.dataDb.close());
    await bestEffort(() => handles.cacheDb.close());
  } finally {
    bindNetworkObserver(undefined);
  }
}
