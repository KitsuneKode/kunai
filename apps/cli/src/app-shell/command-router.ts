import type { Container } from "@/container";
import { switchSessionMode } from "@/app/mode-switch";
import type { TitleInfo } from "@/domain/types";
import { waitForRootHistorySelection } from "./root-history-bridge";

import type { ShellAction } from "./types";
import { handleShellAction } from "./workflows";

type RoutedActionResult =
  | "handled"
  | "quit"
  | "mode-switch"
  | "back-to-search"
  | "back-to-results"
  | "replay"
  | { type: "history-entry"; title: TitleInfo }
  | "unhandled";

async function openRootOwnedOverlay(
  container: Container,
  overlay: Extract<
    import("@/domain/session/SessionState").OverlayState,
    { type: "help" | "about" | "diagnostics" | "provider_picker" | "history" | "settings" }
  >,
): Promise<void> {
  const { stateManager } = container;

  stateManager.dispatch({ type: "OPEN_OVERLAY", overlay });
  await new Promise<void>((resolve) => {
    const unsubscribe = stateManager.subscribe((state) => {
      const top = state.activeModals.at(-1);
      if (!top || top.type !== overlay.type) {
        unsubscribe();
        resolve();
      }
    });
  });
}

export async function routeSearchShellAction({
  action,
  container,
}: {
  action: ShellAction;
  container: Container;
}): Promise<RoutedActionResult> {
  const { stateManager } = container;

  if (action === "quit") return "quit";
  if (action === "toggle-mode") {
    switchSessionMode(stateManager);
    stateManager.dispatch({ type: "RESET_SEARCH" });
    stateManager.dispatch({ type: "SET_SEARCH_STATE", state: "idle" });
    return "mode-switch";
  }
  if (action === "help") {
    await openRootOwnedOverlay(container, { type: "help" });
    return "handled";
  }
  if (action === "about") {
    await openRootOwnedOverlay(container, { type: "about" });
    return "handled";
  }
  if (action === "diagnostics") {
    await openRootOwnedOverlay(container, { type: "diagnostics" });
    return "handled";
  }
  if (action === "provider") {
    const state = stateManager.getState();
    await openRootOwnedOverlay(container, {
      type: "provider_picker",
      currentProvider: state.provider,
      isAnime: state.mode === "anime",
    });
    return "handled";
  }
  if (action === "history") {
    const selectionPromise = waitForRootHistorySelection();
    await openRootOwnedOverlay(container, { type: "history" });
    const selection = await selectionPromise;
    if (!selection) return "handled";
    const providerMetadata = container.providerRegistry.get(selection.entry.provider)?.metadata;
    if (providerMetadata) {
      stateManager.dispatch({
        type: "SET_MODE",
        mode: providerMetadata.isAnimeProvider ? "anime" : "series",
        provider: providerMetadata.id,
      });
    } else {
      stateManager.dispatch({ type: "SET_PROVIDER", provider: selection.entry.provider });
    }
    return {
      type: "history-entry",
      title: {
        id: selection.titleId,
        type: selection.entry.type,
        name: selection.entry.title,
      },
    };
  }
  if (action === "settings") {
    await openRootOwnedOverlay(container, { type: "settings" });
    return "handled";
  }

  const result = await handleShellAction({ action, container });
  return result === "quit" ? "quit" : result;
}

export async function routePlaybackShellAction({
  action,
  container,
}: {
  action: ShellAction;
  container: Container;
}): Promise<RoutedActionResult> {
  const { stateManager } = container;

  if (action === "quit") return "quit";
  if (action === "toggle-mode") {
    switchSessionMode(stateManager);
    return "mode-switch";
  }
  if (action === "search") return "back-to-search";
  if (action === "back-to-results") return "back-to-results";
  if (action === "replay") return "replay";
  if (action === "help") {
    await openRootOwnedOverlay(container, { type: "help" });
    return "handled";
  }
  if (action === "about") {
    await openRootOwnedOverlay(container, { type: "about" });
    return "handled";
  }
  if (action === "diagnostics") {
    await openRootOwnedOverlay(container, { type: "diagnostics" });
    return "handled";
  }
  if (action === "provider") {
    const state = stateManager.getState();
    await openRootOwnedOverlay(container, {
      type: "provider_picker",
      currentProvider: state.provider,
      isAnime: state.mode === "anime",
    });
    return "handled";
  }
  if (action === "history") {
    const selectionPromise = waitForRootHistorySelection();
    await openRootOwnedOverlay(container, { type: "history" });
    const selection = await selectionPromise;
    if (!selection) return "handled";
    const providerMetadata = container.providerRegistry.get(selection.entry.provider)?.metadata;
    if (providerMetadata) {
      stateManager.dispatch({
        type: "SET_MODE",
        mode: providerMetadata.isAnimeProvider ? "anime" : "series",
        provider: providerMetadata.id,
      });
    } else {
      stateManager.dispatch({ type: "SET_PROVIDER", provider: selection.entry.provider });
    }
    return {
      type: "history-entry",
      title: {
        id: selection.titleId,
        type: selection.entry.type,
        name: selection.entry.title,
      },
    };
  }
  if (action === "settings") {
    await openRootOwnedOverlay(container, { type: "settings" });
    return "handled";
  }

  const result = await handleShellAction({ action, container });
  return result === "quit" ? "quit" : result;
}
