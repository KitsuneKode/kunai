import type { SubtitleTrack } from "@/domain/types";
import { isAllowedMpvUrl, type MpvUrlKind } from "@/infra/player/mpv-playback-url";
import { collectAdditionalSubtitleTracks, describeSubtitleTrackForMpv } from "@/mpv";

import type { MpvIpcSession } from "./mpv-ipc";
import { extractExternalSubtitleIds } from "./subtitle-track-cache";

const MPV_SUBTITLE_ATTACH_TIMEOUT_MS = 8_000;

export type PersistentLateSubtitleAttachment = {
  primarySubtitle?: string | null;
  subtitleTracks?: readonly SubtitleTrack[];
};

export type SubtitleAttachmentResult =
  | { readonly status: "attached"; readonly attachedCount: number }
  | { readonly status: "none-requested"; readonly attachedCount: 0 }
  | { readonly status: "no-ipc"; readonly attachedCount: 0 }
  | {
      readonly status: "sub-add-failed";
      readonly attachedCount: number;
      readonly failedTrack: "primary" | "additional";
    };

function externalFilenames(trackList: unknown): ReadonlySet<string> {
  if (!Array.isArray(trackList)) return new Set();
  const names = new Set<string>();
  for (const entry of trackList) {
    if (!entry || typeof entry !== "object") continue;
    const filename = (entry as Record<string, unknown>)["external-filename"];
    if (typeof filename === "string" && filename.length > 0) names.add(filename);
  }
  return names;
}

export class PersistentSubtitleManager {
  private lastTrackList: unknown = null;
  private externalSubtitleIds: number[] = [];
  private episodeChangeOpen = false;
  private fileTracksFrozen = false;
  private removableExternalIds: number[] = [];

  /**
   * Opens the replacement window. Track lists that arrive before the new file
   * loads still belong to the cleanup cache. `noteEpisodeFileLoaded` freezes
   * that cache; a list after the freeze is the new episode.
   */
  beginEpisodeSubtitleChange(): void {
    this.episodeChangeOpen = true;
    this.fileTracksFrozen = false;
    this.removableExternalIds = extractExternalSubtitleIds(this.lastTrackList);
    this.externalSubtitleIds = [...this.removableExternalIds];
  }

  noteEpisodeFileLoaded(): void {
    if (!this.episodeChangeOpen || this.fileTracksFrozen) return;
    this.fileTracksFrozen = true;
    this.removableExternalIds = [...this.externalSubtitleIds];
  }

  settleEpisodeSubtitleChange(): void {
    if (!this.episodeChangeOpen) return;
    this.episodeChangeOpen = false;
    this.fileTracksFrozen = false;
    this.removableExternalIds = [];
    this.externalSubtitleIds = extractExternalSubtitleIds(this.lastTrackList);
  }

  updateTrackList(trackList: unknown): void {
    this.lastTrackList = trackList;
    const ids = extractExternalSubtitleIds(trackList);
    if (!this.episodeChangeOpen || !this.fileTracksFrozen) {
      this.externalSubtitleIds = ids;
      return;
    }
    const removable = new Set(this.removableExternalIds);
    this.externalSubtitleIds = ids.filter((id) => removable.has(id));
  }

  currentTrackList(): unknown {
    return this.lastTrackList;
  }

  cachedExternalSubtitleIds(): number[] {
    return [...this.externalSubtitleIds];
  }

  async removeExternalSubtitles(
    ipcSession: MpvIpcSession | null,
    isCurrent: () => boolean = () => true,
  ): Promise<boolean> {
    if (!ipcSession || !isCurrent()) return false;
    const ids = [...this.externalSubtitleIds];
    if (ids.length === 0) return true;

    for (const trackId of ids) {
      if (!isCurrent()) return false;
      await ipcSession.send(["sub-remove", trackId], 1_000);
      if (!isCurrent()) return false;
    }
    return true;
  }

  async replaceSubtitleInventory(
    ipcSession: MpvIpcSession | null,
    primarySubtitle: string | null,
    subtitleTracks?: readonly SubtitleTrack[],
    onAttached?: (trackCount: number) => void,
    primarySubtitleKind: MpvUrlKind = "remote",
    isCurrent: () => boolean = () => true,
  ): Promise<void> {
    if (!ipcSession || !isCurrent()) return;

    if (!(await this.removeExternalSubtitles(ipcSession, isCurrent))) return;

    const alreadyArrived = this.episodeChangeOpen ? externalFilenames(this.lastTrackList) : null;
    const safePrimary =
      primarySubtitle &&
      isAllowedMpvUrl(primarySubtitle, primarySubtitleKind) &&
      !alreadyArrived?.has(primarySubtitle)
        ? primarySubtitle
        : null;
    if (safePrimary) {
      const primary = describeSubtitleTrackForMpv(safePrimary, subtitleTracks);
      const result = await ipcSession.send(
        ["sub-add", safePrimary, "select", primary.title, primary.language],
        MPV_SUBTITLE_ATTACH_TIMEOUT_MS,
      );
      if (!result.ok || !isCurrent()) return;
    }

    const additionalTracks = collectAdditionalSubtitleTracks(
      primarySubtitle,
      subtitleTracks,
    ).filter(
      (track) =>
        isAllowedMpvUrl(track.url, "remote") &&
        track.url !== safePrimary &&
        !alreadyArrived?.has(track.url),
    );
    for (const track of additionalTracks) {
      if (!isCurrent()) return;
      const result = await ipcSession.send(
        ["sub-add", track.url, "auto", track.display ?? "", track.language ?? ""],
        MPV_SUBTITLE_ATTACH_TIMEOUT_MS,
      );
      if (!result.ok || !isCurrent()) return;
    }

    const attachedCount = (safePrimary ? 1 : 0) + additionalTracks.length;
    if (attachedCount > 0 && isCurrent()) {
      onAttached?.(attachedCount);
    }
  }

  async attachSubtitles(
    ipcSession: MpvIpcSession | null,
    attachment: PersistentLateSubtitleAttachment,
  ): Promise<SubtitleAttachmentResult> {
    if (!ipcSession) return { status: "no-ipc", attachedCount: 0 };
    let attached = 0;
    const safePrimary =
      attachment.primarySubtitle && isAllowedMpvUrl(attachment.primarySubtitle, "remote")
        ? attachment.primarySubtitle
        : null;
    const additionalTracks = collectAdditionalSubtitleTracks(
      safePrimary,
      attachment.subtitleTracks,
    ).filter((track) => isAllowedMpvUrl(track.url, "remote"));
    if (!safePrimary && additionalTracks.length === 0) {
      return { status: "none-requested", attachedCount: 0 };
    }

    if (safePrimary) {
      const primary = describeSubtitleTrackForMpv(safePrimary, attachment.subtitleTracks);
      const result = await ipcSession.send(
        ["sub-add", safePrimary, "select", primary.title, primary.language],
        MPV_SUBTITLE_ATTACH_TIMEOUT_MS,
      );
      if (result.ok) attached += 1;
      else return { status: "sub-add-failed", attachedCount: attached, failedTrack: "primary" };
    }

    for (const track of additionalTracks) {
      const result = await ipcSession.send(
        ["sub-add", track.url, "auto", track.display ?? "", track.language ?? ""],
        MPV_SUBTITLE_ATTACH_TIMEOUT_MS,
      );
      if (result.ok) attached += 1;
      else return { status: "sub-add-failed", attachedCount: attached, failedTrack: "additional" };
    }

    return attached > 0
      ? { status: "attached", attachedCount: attached }
      : { status: "none-requested", attachedCount: 0 };
  }
}
