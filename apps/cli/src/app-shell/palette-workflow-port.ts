import type { Container } from "@/container";

import type { NotificationPlaybackIntent, RootOwnedOverlay } from "./root-overlay-bridge";
import type { QueuePlaybackLaunch } from "./root-queue-bridge";
import type { ShellAction } from "./types";
import type { ShellWorkflowResult } from "./workflows/shell-workflows";

export type PaletteWorkflowLoaders = {
  readonly loadShellWorkflows: () => Promise<
    Pick<
      typeof import("./workflows/shell-workflows"),
      "handleShellAction" | "resolveQuitWithDownloadQueue"
    >
  >;
  readonly loadSetupWorkflow: () => Promise<
    Pick<typeof import("./workflows/setup-workflows"), "openSetupWizardFromShell">
  >;
  readonly loadOverlayBridge: () => Promise<
    Pick<
      typeof import("./root-overlay-bridge"),
      "openDiagnosticsOverlay" | "openNotificationsOverlay" | "openRootOwnedOverlay"
    >
  >;
  readonly loadQueueBridge: () => Promise<
    Pick<typeof import("./root-queue-bridge"), "waitForRootQueueSelection">
  >;
};

const defaultLoaders: PaletteWorkflowLoaders = {
  loadShellWorkflows: () => import("./workflows/shell-workflows"),
  loadSetupWorkflow: () => import("./workflows/setup-workflows"),
  loadOverlayBridge: () => import("./root-overlay-bridge"),
  loadQueueBridge: () => import("./root-queue-bridge"),
};

/**
 * The palette dispatcher's outbound dependency seam.
 *
 * Overlay and queue routing belong here rather than being imported directly:
 * `mock.module` is process-global and applied at load time, so a test that
 * stubbed `@/app-shell/root-overlay-bridge` replaced those exports for every
 * *other* file in the run too. Whether that broke anything depended on
 * test-file load order, which differs between Linux and Windows — the suite
 * passed on Linux and failed on Windows for the same commit. Injecting a port
 * keeps the swap local to the test that wants it.
 */
export interface PaletteWorkflowPort {
  resolveQuit(container: Container): Promise<"handled" | "quit">;
  runSetup(container: Container): Promise<"handled">;
  runAction(action: ShellAction, container: Container): Promise<ShellWorkflowResult>;
  openOverlay(container: Container, overlay: RootOwnedOverlay): Promise<void>;
  openDiagnostics(container: Container, source: string): Promise<void>;
  openNotifications(container: Container): Promise<{
    readonly playback: NotificationPlaybackIntent | null;
  }>;
  waitForQueueSelection(): Promise<QueuePlaybackLaunch | null>;
}

export function createPaletteWorkflowPort(
  loaders: Partial<PaletteWorkflowLoaders> = {},
): PaletteWorkflowPort {
  const resolved = { ...defaultLoaders, ...loaders };
  return {
    async resolveQuit(container) {
      const result = await (
        await resolved.loadShellWorkflows()
      ).resolveQuitWithDownloadQueue(container);
      return result === "quit" ? "quit" : "handled";
    },
    async runSetup(container) {
      const { openSetupWizardFromShell } = await resolved.loadSetupWorkflow();
      await openSetupWizardFromShell(container, { force: true, closeOverlays: true });
      return "handled";
    },
    async runAction(action, container) {
      const { handleShellAction } = await resolved.loadShellWorkflows();
      return handleShellAction({ action, container });
    },
    async openOverlay(container, overlay) {
      const { openRootOwnedOverlay } = await resolved.loadOverlayBridge();
      await openRootOwnedOverlay(container, overlay);
    },
    async openDiagnostics(container, source) {
      const { openDiagnosticsOverlay } = await resolved.loadOverlayBridge();
      await openDiagnosticsOverlay(container, source);
    },
    async openNotifications(container) {
      const { openNotificationsOverlay } = await resolved.loadOverlayBridge();
      return openNotificationsOverlay(container);
    },
    async waitForQueueSelection() {
      const { waitForRootQueueSelection } = await resolved.loadQueueBridge();
      return waitForRootQueueSelection();
    },
  };
}

export const defaultPaletteWorkflowPort = createPaletteWorkflowPort();
