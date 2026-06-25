import { dirname, join } from "node:path";

import { chooseFromListShell } from "@/app-shell/pickers";
import { describeKunaiHandoffLaunch, type KunaiHandoffLaunch } from "@/app/bootstrap/handoff-url";
import type { Container } from "@/container";
import { getKunaiPaths } from "@/services/storage/storage-read-models";

import { runSetupFlow } from "../setup-shell";

export type SetupWizardResult = "completed" | "cancelled" | "skipped";

export async function confirmProtocolHandoff(handoff: KunaiHandoffLaunch): Promise<boolean> {
  const choice = await chooseFromListShell({
    title: "Open Kunai Link",
    subtitle: describeKunaiHandoffLaunch(handoff),
    options: [
      {
        value: "continue" as const,
        label: "Continue",
        detail: "Run this local Kunai action",
      },
      {
        value: "cancel" as const,
        label: "Cancel",
        detail: "Ignore the external link and close",
      },
    ],
  });

  return choice === "continue";
}

export async function runSetupWizard({
  container,
  force = false,
}: {
  container: Container;
  force?: boolean;
}): Promise<SetupWizardResult> {
  const current = container.config.getRaw();
  const needsOnboarding = current.onboardingVersion < 2 || !current.downloadOnboardingDismissed;
  if (!force && !needsOnboarding) {
    return "skipped";
  }

  const snapshot = container.capabilitySnapshot ?? {
    mpv: Boolean(Bun.which("mpv")),
    ffprobe: Boolean(Bun.which("ffprobe")),
    ytDlp: Boolean(Bun.which("yt-dlp")),
    chafa: Boolean(Bun.which("chafa")),
    magick: Boolean(Bun.which("magick")),
    image: {
      renderer: "none",
      terminal: "unknown",
      available: false,
    } as import("@/image").ImageCapability,
    issues: [],
  };

  const defaultDownloadPath = join(dirname(getKunaiPaths().dataDbPath), "downloads");
  const { result } = runSetupFlow(snapshot);
  const { outcome, prefs } = await result;

  if (outcome === "skipped") {
    await container.config.update({
      onboardingVersion: 2,
      downloadOnboardingDismissed: true,
    });
    await container.config.save();
  } else {
    const downloadsEnabled = prefs.downloadsEnabled;
    const downloadPath = downloadsEnabled
      ? current.downloadPath || defaultDownloadPath
      : current.downloadPath;

    await container.config.update({
      onboardingVersion: 2,
      downloadOnboardingDismissed: true,
      downloadsEnabled,
      downloadPath,
      animeLanguageProfile: {
        ...current.animeLanguageProfile,
        audio: prefs.audio,
        subtitle: prefs.subtitle,
      },
      seriesLanguageProfile: {
        ...current.seriesLanguageProfile,
        subtitle: prefs.subtitle,
      },
      movieLanguageProfile: {
        ...current.movieLanguageProfile,
        subtitle: prefs.subtitle,
      },
    });
    await container.config.save();
  }

  container.diagnosticsService.record({
    category: "session",
    message: outcome === "completed" ? "Setup wizard completed" : "Setup wizard skipped",
    context: { outcome, force },
  });

  return outcome === "completed" ? "completed" : "skipped";
}

function closeActiveOverlays(container: Container): void {
  let guard = 0;
  while (container.stateManager.getState().activeModals.length > 0 && guard < 32) {
    container.stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" });
    guard += 1;
  }
}

/** Run setup from a shell command and block until the wizard finishes. */
export async function openSetupWizardFromShell(
  container: Container,
  options: { readonly force?: boolean; readonly closeOverlays?: boolean } = {},
): Promise<SetupWizardResult> {
  if (options.closeOverlays ?? true) {
    closeActiveOverlays(container);
  }

  const result = await runSetupWizard({ container, force: options.force ?? true });
  const note =
    result === "completed" ? "Setup complete." : result === "skipped" ? "Setup skipped." : null;
  if (note) {
    container.stateManager.dispatch({ type: "SET_PLAYBACK_FEEDBACK", note });
  }
  return result;
}
