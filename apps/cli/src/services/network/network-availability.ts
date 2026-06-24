import type { Container } from "@/container";

/** Whether online provider/search work is allowed for this session. */
export function isNetworkAvailable(
  container: Pick<Container, "config"> & Partial<Pick<Container, "networkStatus">>,
): boolean {
  if (container.config.offlineMode) return false;
  return container.networkStatus?.isAvailable() ?? true;
}
