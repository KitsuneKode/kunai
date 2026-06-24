import type { KunaiDatabase } from "@kunai/storage";

import { bindNetworkObserver } from "../services/network/network-observation";
import type { Container } from "./types";

export type ContainerDisposeHandles = {
  readonly dataDb: KunaiDatabase;
  readonly cacheDb: KunaiDatabase;
  downloadResolveAbort: AbortController | null;
};

const disposeHandlesByContainer = new WeakMap<Container, ContainerDisposeHandles>();

export function registerContainerDisposeHandles(
  container: Container,
  handles: ContainerDisposeHandles,
): void {
  disposeHandlesByContainer.set(container, handles);
}

export function abortOrphanDownloadResolve(container: Container): void {
  disposeHandlesByContainer.get(container)?.downloadResolveAbort?.abort();
}

export async function disposeContainer(container: Container | null | undefined): Promise<void> {
  if (!container) return;
  const handles = disposeHandlesByContainer.get(container);
  if (!handles) return;

  abortOrphanDownloadResolve(container);

  try {
    container.backgroundWorkScheduler.recordShutdown("container-dispose");
    await container.backgroundWorkScheduler.drain();
  } catch {
    // Best-effort drain during teardown.
  }

  try {
    container.diagnosticsService.flush();
  } catch {
    // Best-effort diagnostics flush during teardown.
  }

  try {
    handles.dataDb.close();
  } catch {
    // Best-effort DB close during teardown.
  }

  try {
    handles.cacheDb.close();
  } catch {
    // Best-effort DB close during teardown.
  }

  disposeHandlesByContainer.delete(container);
  bindNetworkObserver(undefined);
}
