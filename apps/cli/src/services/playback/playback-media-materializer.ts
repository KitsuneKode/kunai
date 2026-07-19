import type { StreamInfo } from "@/domain/types";

import {
  materializeDeferredMediaForPlayback,
  type MaterializedDeferredMedia,
} from "./deferred-media-materializer";
import {
  materializeHlsManifestForPlayback,
  type HlsMaterializeSkipReason,
} from "./hls-manifest-materializer";

export type PlaybackMediaMaterializationKind = "none" | "dash-mpd" | "hls-manifest";

export type MaterializedPlaybackMedia = MaterializedDeferredMedia & {
  readonly kind: PlaybackMediaMaterializationKind;
};

export async function materializePlaybackMediaForPlayback(
  stream: StreamInfo,
  onHlsSkipped?: (reason: HlsMaterializeSkipReason, detail?: string) => void,
): Promise<MaterializedPlaybackMedia> {
  const deferred = await materializeDeferredMediaForPlayback(stream);
  if (stream.deferredLocator) {
    return { ...deferred, kind: "dash-mpd" };
  }

  const hls = await materializeHlsManifestForPlayback(deferred.stream, onHlsSkipped);
  if (hls) {
    return { ...hls, kind: "hls-manifest" };
  }

  return { ...deferred, kind: "none" };
}
