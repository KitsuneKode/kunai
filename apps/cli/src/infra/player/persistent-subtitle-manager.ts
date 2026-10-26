import type { SubtitleTrack } from "@/domain/types";
import { isAllowedMpvUrl, type MpvUrlKind } from "@/infra/player/mpv-playback-url";
import { collectAdditionalSubtitleTracks, describeSubtitleTrackForMpv } from "@/mpv";
import { isJsonNumber, isJsonObject } from "@kunai/types";

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
  constructor(private readonly isSelectionEnabled: () => boolean = () => true) {}

  private observedSubtitleId: number | undefined;
  private explicitlyOff = false;

  noteSelectedSubtitle(id: number, explicit = false): void {
    if (id === 0 && (explicit || (this.observedSubtitleId ?? 0) > 0)) this.explicitlyOff = true;
    if (id > 0) this.explicitlyOff = false;
    this.observedSubtitleId = id;
  }
  resetSelectionObservation(): void {
    this.observedSubtitleId = undefined;
    this.explicitlyOff = false;
  }
  private selectionEnabled(): boolean {
    return this.observedSubtitleId !== undefined && this.observedSubtitleId > 0
      ? true
      : !this.explicitlyOff && this.isSelectionEnabled();
  }

  shouldSelectLatePrimary(): boolean {
    return this.selectionEnabled() && !(this.observedSubtitleId && this.observedSubtitleId > 0);
  }

  private async preserveOff(ipc: MpvIpcSession, isCurrent: () => boolean): Promise<void> {
    if (isCurrent() && !this.selectionEnabled()) {
      await ipc.send(["set_property", "sid", "no"], 1_000);
    }
  }

  private lastTrackList: unknown = null;
  private externalSubtitleIds: number[] = [];

  updateTrackList(trackList: unknown): void {
    this.lastTrackList = trackList;
    this.externalSubtitleIds = extractExternalSubtitleIds(trackList);
  }

  currentTrackList(): unknown {
    return this.lastTrackList;
  }

  findExternalSubtitleId(url: string): number | undefined {
    if (!isAllowedMpvUrl(url, "remote") || !Array.isArray(this.lastTrackList)) return undefined;
    const track = this.lastTrackList.find(
      (value) =>
        isJsonObject(value) &&
        value.type === "sub" &&
        value.external === true &&
        value["external-filename"] === url &&
        isJsonNumber(value.id) &&
        Number.isSafeInteger(value.id) &&
        value.id > 0,
    );
    return isJsonObject(track) && isJsonNumber(track.id) ? track.id : undefined;
  }

  cachedExternalSubtitleIds(): number[] {
    return [...this.externalSubtitleIds];
  }

  async removeExternalSubtitles(
    ipcSession: MpvIpcSession | null,
    isCurrent: () => boolean = () => true,
  ): Promise<boolean> {
    if (!ipcSession || !isCurrent()) return false;
    if (this.externalSubtitleIds.length === 0) return true;

    for (const trackId of this.externalSubtitleIds) {
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

    const safePrimary =
      primarySubtitle && isAllowedMpvUrl(primarySubtitle, primarySubtitleKind)
        ? primarySubtitle
        : null;
    if (safePrimary) {
      const primary = describeSubtitleTrackForMpv(safePrimary, subtitleTracks);
      const result = await ipcSession.send(
        [
          "sub-add",
          safePrimary,
          this.selectionEnabled() ? "select" : "auto",
          primary.title,
          primary.language,
        ],
        MPV_SUBTITLE_ATTACH_TIMEOUT_MS,
      );
      if (!result.ok || !isCurrent()) return;
    }

    const additionalTracks = collectAdditionalSubtitleTracks(safePrimary, subtitleTracks).filter(
      (track) => isAllowedMpvUrl(track.url, "remote"),
    );
    for (const track of additionalTracks) {
      if (!isCurrent()) return;
      const result = await ipcSession.send(
        ["sub-add", track.url, "auto", track.display ?? "", track.language ?? ""],
        MPV_SUBTITLE_ATTACH_TIMEOUT_MS,
      );
      if (!result.ok || !isCurrent()) return;
    }

    await this.preserveOff(ipcSession, isCurrent);
    const attachedCount = (safePrimary ? 1 : 0) + additionalTracks.length;
    if (attachedCount > 0 && isCurrent()) {
      onAttached?.(attachedCount);
    }
  }

  async attachSubtitles(
    ipcSession: MpvIpcSession | null,
    attachment: PersistentLateSubtitleAttachment,
    isCurrent: () => boolean = () => true,
    selectPrimary = true,
  ): Promise<SubtitleAttachmentResult> {
    if (!ipcSession || !isCurrent()) return { status: "no-ipc", attachedCount: 0 };
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
        [
          "sub-add",
          safePrimary,
          selectPrimary && this.selectionEnabled() ? "select" : "auto",
          primary.title,
          primary.language,
        ],
        MPV_SUBTITLE_ATTACH_TIMEOUT_MS,
      );
      if (!isCurrent()) return { status: "none-requested", attachedCount: 0 };
      await this.preserveOff(ipcSession, isCurrent);
      if (result.ok) attached += 1;
      else return { status: "sub-add-failed", attachedCount: attached, failedTrack: "primary" };
    }

    for (const track of additionalTracks) {
      if (!isCurrent()) return { status: "none-requested", attachedCount: 0 };
      const result = await ipcSession.send(
        ["sub-add", track.url, "auto", track.display ?? "", track.language ?? ""],
        MPV_SUBTITLE_ATTACH_TIMEOUT_MS,
      );
      if (!isCurrent()) return { status: "none-requested", attachedCount: 0 };
      await this.preserveOff(ipcSession, isCurrent);
      if (result.ok) attached += 1;
      else return { status: "sub-add-failed", attachedCount: attached, failedTrack: "additional" };
    }

    return attached > 0
      ? { status: "attached", attachedCount: attached }
      : { status: "none-requested", attachedCount: 0 };
  }
}
