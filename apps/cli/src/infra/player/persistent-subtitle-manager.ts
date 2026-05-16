import type { SubtitleTrack } from "@/domain/types";
import { collectAdditionalSubtitleTracks, describeSubtitleTrackForMpv } from "@/mpv";

import type { MpvIpcSession } from "./mpv-ipc";
import { extractExternalSubtitleIds } from "./subtitle-track-cache";

export type PersistentLateSubtitleAttachment = {
  primarySubtitle?: string | null;
  subtitleTracks?: readonly SubtitleTrack[];
};

export class PersistentSubtitleManager {
  private lastTrackList: unknown = null;
  private externalSubtitleIds: number[] = [];

  updateTrackList(trackList: unknown): void {
    this.lastTrackList = trackList;
    this.externalSubtitleIds = extractExternalSubtitleIds(trackList);
  }

  currentTrackList(): unknown {
    return this.lastTrackList;
  }

  cachedExternalSubtitleIds(): number[] {
    return [...this.externalSubtitleIds];
  }

  async removeExternalSubtitles(ipcSession: MpvIpcSession | null): Promise<void> {
    if (!ipcSession) return;
    if (this.externalSubtitleIds.length === 0) return;

    for (const trackId of this.externalSubtitleIds) {
      await ipcSession.send(["sub-remove", trackId], 1_000);
    }
  }

  async replaceSubtitleInventory(
    ipcSession: MpvIpcSession | null,
    primarySubtitle: string | null,
    subtitleTracks?: readonly SubtitleTrack[],
    onAttached?: (trackCount: number) => void,
  ): Promise<void> {
    if (!ipcSession) return;

    await this.removeExternalSubtitles(ipcSession);

    if (primarySubtitle) {
      const primary = describeSubtitleTrackForMpv(primarySubtitle, subtitleTracks);
      const result = await ipcSession.send([
        "sub-add",
        primarySubtitle,
        "select",
        primary.title,
        primary.language,
      ]);
      if (!result.ok) return;
    }

    const additionalTracks = collectAdditionalSubtitleTracks(primarySubtitle, subtitleTracks);
    for (const track of additionalTracks) {
      const result = await ipcSession.send([
        "sub-add",
        track.url,
        "auto",
        track.display ?? "",
        track.language ?? "",
      ]);
      if (!result.ok) return;
    }

    const attachedCount = (primarySubtitle ? 1 : 0) + additionalTracks.length;
    if (attachedCount > 0) {
      onAttached?.(attachedCount);
    }
  }

  async attachSubtitles(
    ipcSession: MpvIpcSession | null,
    attachment: PersistentLateSubtitleAttachment,
  ): Promise<number> {
    if (!ipcSession) return 0;
    let attached = 0;

    if (attachment.primarySubtitle) {
      const primary = describeSubtitleTrackForMpv(
        attachment.primarySubtitle,
        attachment.subtitleTracks,
      );
      const result = await ipcSession.send([
        "sub-add",
        attachment.primarySubtitle,
        "select",
        primary.title,
        primary.language,
      ]);
      if (result.ok) attached += 1;
    }

    for (const track of collectAdditionalSubtitleTracks(
      attachment.primarySubtitle ?? null,
      attachment.subtitleTracks,
    )) {
      const result = await ipcSession.send([
        "sub-add",
        track.url,
        "auto",
        track.display ?? "",
        track.language ?? "",
      ]);
      if (result.ok) attached += 1;
    }

    return attached;
  }
}
