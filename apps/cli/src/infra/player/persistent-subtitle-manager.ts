import type { SubtitleTrack } from "@/domain/types";
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
      const result = await ipcSession.send(
        ["sub-add", primarySubtitle, "select", primary.title, primary.language],
        MPV_SUBTITLE_ATTACH_TIMEOUT_MS,
      );
      if (!result.ok) return;
    }

    const additionalTracks = collectAdditionalSubtitleTracks(primarySubtitle, subtitleTracks);
    for (const track of additionalTracks) {
      const result = await ipcSession.send(
        ["sub-add", track.url, "auto", track.display ?? "", track.language ?? ""],
        MPV_SUBTITLE_ATTACH_TIMEOUT_MS,
      );
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
  ): Promise<SubtitleAttachmentResult> {
    if (!ipcSession) return { status: "no-ipc", attachedCount: 0 };
    let attached = 0;
    const additionalTracks = collectAdditionalSubtitleTracks(
      attachment.primarySubtitle ?? null,
      attachment.subtitleTracks,
    );
    if (!attachment.primarySubtitle && additionalTracks.length === 0) {
      return { status: "none-requested", attachedCount: 0 };
    }

    if (attachment.primarySubtitle) {
      const primary = describeSubtitleTrackForMpv(
        attachment.primarySubtitle,
        attachment.subtitleTracks,
      );
      const result = await ipcSession.send(
        ["sub-add", attachment.primarySubtitle, "select", primary.title, primary.language],
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
