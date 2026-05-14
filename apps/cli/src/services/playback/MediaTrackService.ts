import {
  buildMediaTrackModel,
  type ActiveMediaTrackState,
  type MediaTrackModel,
} from "@/domain/media/media-track-model";
import type { StreamInfo } from "@/domain/types";

export class MediaTrackService {
  buildModel(stream: StreamInfo, active?: ActiveMediaTrackState): MediaTrackModel {
    return buildMediaTrackModel(stream, active);
  }
}
