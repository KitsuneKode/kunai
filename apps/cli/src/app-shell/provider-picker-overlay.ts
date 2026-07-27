import { openRootOwnedOverlay } from "@/app-shell/root-overlay-bridge";
import type { Container } from "@/container";
import { shellModeToProviderLane } from "@/domain/provider-lane";

/** Open the single root-owned session provider picker and wait for it to close. */
export async function openSessionProviderPicker(container: Container): Promise<void> {
  const state = container.stateManager.getState();
  await openRootOwnedOverlay(container, {
    type: "provider_picker",
    currentProvider: state.provider,
    lane: shellModeToProviderLane(state.mode),
  });
}
