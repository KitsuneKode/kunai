import { chooseFromListShell } from "@/app-shell/pickers";
import type { Container } from "@/container";
import type { ShellMode, TitleInfo } from "@/domain/types";
import { copyToClipboard } from "@/infra/clipboard";
import { copyShareLinkForContext } from "@/infra/share/copy-share-link";
import { formatTimestamp } from "@/services/continuation/history-progress";
import type { MediaKind } from "@kunai/types";

/** What a share link points at: the session's title, or a row someone picked. */
export interface ShareTarget {
  readonly title: TitleInfo;
  readonly episode?: { readonly season: number; readonly episode: number };
  readonly mode: ShellMode;
  readonly mediaKind: MediaKind;
  readonly providerId?: string;
}

/**
 * Copy a share link for `target`, offering the saved resume time when there is
 * one, and optionally show its QR code. Shared by `/share` (the session's
 * title) and a History row, which names a title the session is not playing.
 */
export async function shareTarget(
  container: Container,
  target: ShareTarget,
  options: { readonly qr?: boolean } = {},
): Promise<"handled"> {
  const { title, episode, mode, mediaKind } = target;
  const progress =
    episode &&
    container.historyRepository.getProgress(
      { id: title.id, kind: mediaKind, title: title.name, externalIds: title.externalIds },
      { season: episode.season, episode: episode.episode },
    );
  const resumeSeconds =
    progress && progress.positionSeconds > 0 ? Math.floor(progress.positionSeconds) : undefined;

  let startSeconds: number | undefined;
  if (resumeSeconds && resumeSeconds > 10) {
    const choice = await chooseFromListShell({
      title: "Copy share link",
      subtitle: title.name,
      options: [
        { value: "start" as const, label: "Copy link from start" },
        { value: "resume" as const, label: `Copy link at ${formatTimestamp(resumeSeconds)}` },
      ],
    });
    if (!choice) return "handled";
    startSeconds = choice === "resume" ? resumeSeconds : undefined;
  }

  const shared = await copyShareLinkForContext(
    { title, mode, episode, startSeconds, providerId: target.providerId },
    copyToClipboard,
  );
  if (!shared) {
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note: "Could not build a share link for this title.",
    });
    return "handled";
  }
  if (options.qr) {
    const { openShareQrShell } = await import("@/app-shell/share-qr-shell");
    await openShareQrShell({ title: title.name, url: shared.qrUrl, shortCode: shared.shortCode });
  }
  container.stateManager.dispatch({
    type: "SET_PLAYBACK_FEEDBACK",
    note: shared.copied
      ? `Web share link for "${title.name}" copied${shared.shortCode ? ` · code ${shared.shortCode}` : ""}.`
      : `Share link (copy manually): ${shared.webUrl}`,
  });
  return "handled";
}
