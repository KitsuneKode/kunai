import { isJsonNumber, isJsonObject, isJsonString } from "@kunai/types";

import { applyObservedPropertySample, type PlayerStatsState } from "../mpv-stats";

/** What one `GET /requests/status.json` from VLC's HTTP interface says. */
export type VlcStatus = {
  readonly state: "playing" | "paused" | "stopped" | "other";
  /** `position × length`: VLC's `time` is whole seconds only. */
  readonly positionSeconds: number;
  readonly durationSeconds: number;
  /** The video stream VLC opened, or undefined when there is none. */
  readonly video?: { readonly codec?: string };
  /** Pictures that reached the video output — VLC's proof a frame decoded. */
  readonly displayedPictures: number;
};

/** Parse VLC's status JSON; null when it is not a VLC status document. */
export function parseVlcStatus<T>(json: T): VlcStatus | null {
  if (!isJsonObject(json) || !isJsonString(json.state)) return null;
  const length = isJsonNumber(json.length) ? Math.max(0, json.length) : 0;
  const time = isJsonNumber(json.time) ? Math.max(0, json.time) : 0;
  const position = isJsonNumber(json.position) ? json.position : 0;
  const positionSeconds = length > 0 && position > 0 ? position * length : time;
  const stats = isJsonObject(json.stats) ? json.stats : null;
  const displayed = stats && isJsonNumber(stats.displayedpictures) ? stats.displayedpictures : 0;

  let video: VlcStatus["video"];
  const information = isJsonObject(json.information) ? json.information : null;
  const category = information && isJsonObject(information.category) ? information.category : null;
  if (category) {
    for (const [key, value] of Object.entries(category)) {
      if (!key.startsWith("Stream") || !isJsonObject(value) || value.Type !== "Video") continue;
      video = isJsonString(value.Codec) ? { codec: value.Codec } : {};
      break;
    }
  }

  const raw = json.state;
  const state: VlcStatus["state"] =
    raw === "playing"
      ? "playing"
      : raw === "paused"
        ? "paused"
        : raw === "stopped"
          ? "stopped"
          : "other";
  return video
    ? { state, positionSeconds, durationSeconds: length, video, displayedPictures: displayed }
    : { state, positionSeconds, durationSeconds: length, displayedPictures: displayed };
}

/**
 * The track list a VLC status implies, in mpv's `track-list` shape, so the
 * output gate (`playback-output-gate.ts`) reads both players the same way.
 * Undefined before VLC has opened the input (no length yet): that is "unknown",
 * not "audio-only".
 */
export function vlcTrackList(
  status: VlcStatus,
):
  | readonly { readonly type: string; readonly selected: boolean; readonly codec?: string }[]
  | undefined {
  if (status.durationSeconds <= 0 && !status.video) return undefined;
  if (!status.video) return [{ type: "audio", selected: true }];
  return status.video.codec
    ? [{ type: "video", selected: true, codec: status.video.codec }]
    : [{ type: "video", selected: true }];
}

/**
 * Fold a VLC status into the same stats state mpv feeds, so trusted progress,
 * the premature-EOF guard, the watchdog, the output gate and the final
 * `PlaybackResult` all run unchanged.
 *
 * `displayedpictures` is a running total, so "frames are reaching the output
 * now" is a rise since the previous poll — that is what `vo-configured` means
 * here, and what lets the watchdog see frames stop mid-playback. A paused or
 * buffering player stops the clock too, which the watchdog already excuses.
 */
export function applyVlcStatus(
  stats: PlayerStatsState,
  status: VlcStatus,
  previousDisplayedPictures: number,
  observedAt: number,
): void {
  applyObservedPropertySample(stats, {
    name: "duration",
    value: status.durationSeconds,
    observedAt,
  });
  applyObservedPropertySample(stats, {
    name: "pause",
    value: status.state === "paused",
    observedAt,
  });
  const tracks = vlcTrackList(status);
  if (tracks) applyObservedPropertySample(stats, { name: "track-list", value: tracks, observedAt });
  const framesArriving =
    status.displayedPictures > previousDisplayedPictures ||
    (status.state === "paused" && status.displayedPictures > 0);
  applyObservedPropertySample(stats, { name: "vo-configured", value: framesArriving, observedAt });
  applyObservedPropertySample(stats, {
    name: "time-pos",
    value: status.positionSeconds,
    observedAt,
  });
}
