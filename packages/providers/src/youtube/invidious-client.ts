import { markInvidiousInstanceFailure, pickInvidiousInstance } from "./invidious-instance-pool";

export type InvidiousSearchItem =
  | InvidiousSearchVideo
  | InvidiousSearchPlaylist
  | InvidiousSearchChannel;

export type InvidiousSearchVideo = {
  readonly type: "video";
  readonly title: string;
  readonly videoId: string;
  readonly author: string;
  readonly authorId: string;
  readonly description?: string;
  readonly viewCount?: number;
  readonly published?: number;
  readonly publishedText?: string;
  readonly lengthSeconds?: number;
  readonly liveNow?: boolean;
  readonly paid?: boolean;
  readonly premium?: boolean;
  readonly videoThumbnails?: readonly {
    readonly quality?: string;
    readonly url?: string;
  }[];
};

export type InvidiousSearchPlaylist = {
  readonly type: "playlist";
  readonly title: string;
  readonly playlistId: string;
  readonly author?: string;
  readonly authorId?: string;
  readonly videoCount?: number;
  readonly playlistThumbnail?: string;
};

export type InvidiousSearchChannel = {
  readonly type: "channel";
  readonly author: string;
  readonly authorId: string;
  readonly videoCount?: number;
  readonly description?: string;
  readonly authorThumbnails?: readonly {
    readonly quality?: string;
    readonly url?: string;
  }[];
};

export type InvidiousPlaylistVideo = {
  readonly title?: string;
  readonly videoId?: string;
  readonly lengthSeconds?: number;
  readonly index?: number;
};

export type InvidiousClientOptions = {
  readonly preferredInstanceUrl?: string;
  readonly signal?: AbortSignal;
};

export async function invidiousSearch(
  query: string,
  options: InvidiousClientOptions = {},
): Promise<readonly InvidiousSearchItem[]> {
  const params = new URLSearchParams({
    q: query,
    type: "all",
    sort_by: "relevance",
  });
  return requestInvidiousJson<readonly InvidiousSearchItem[]>(
    `/api/v1/search?${params.toString()}`,
    options,
  );
}

export async function invidiousGetPlaylist(
  playlistId: string,
  options: InvidiousClientOptions = {},
): Promise<{
  readonly title?: string;
  readonly author?: string;
  readonly authorId?: string;
  readonly videoCount?: number;
  readonly videos?: readonly InvidiousPlaylistVideo[];
}> {
  return requestInvidiousJson(`/api/v1/playlists/${encodeURIComponent(playlistId)}`, options);
}

export async function invidiousGetChannelVideos(
  channelId: string,
  options: InvidiousClientOptions = {},
): Promise<{
  readonly author?: string;
  readonly authorId?: string;
  readonly latestVideos?: readonly InvidiousPlaylistVideo[];
  readonly videos?: readonly InvidiousPlaylistVideo[];
}> {
  return requestInvidiousJson(`/api/v1/channels/${encodeURIComponent(channelId)}`, options);
}

async function requestInvidiousJson<T>(
  path: string,
  options: InvidiousClientOptions,
  attempt = 0,
): Promise<T> {
  const instance = await pickInvidiousInstance({
    preferredInstanceUrl: options.preferredInstanceUrl,
    signal: options.signal,
  });
  if (options.signal?.aborted) {
    throw new Error("Invidious request aborted");
  }
  const url = `${instance}${path.startsWith("/") ? path : `/${path}`}`;
  try {
    const response = await fetch(url, {
      signal: options.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`Invidious request failed (${response.status})`);
    }
    return (await response.json()) as T;
  } catch (error) {
    if (options.signal?.aborted) throw error;
    markInvidiousInstanceFailure(instance);
    if (attempt >= 2) throw error;
    return requestInvidiousJson<T>(path, options, attempt + 1);
  }
}
