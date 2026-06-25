import { chooseFromListShell } from "@/app-shell/pickers";
import type { Container } from "@/container";
import type { MediaItemIdentity } from "@/domain/media/media-item-identity";

import { buildPickerActionContext } from "./shell-workflows";

export type PlaylistAddResult = {
  readonly playlistId: string;
  readonly playlistName: string;
};

export async function addMediaItemToPickedPlaylist(
  container: Container,
  item: MediaItemIdentity,
): Promise<PlaylistAddResult | null> {
  const { durablePlaylistService } = container;
  const actionContext = buildPickerActionContext({ container, taskLabel: "Add to playlist" });

  type PickAction =
    | { readonly type: "playlist"; readonly id: string; readonly name: string }
    | { readonly type: "create" }
    | { readonly type: "cancel" };

  while (true) {
    const playlists = durablePlaylistService.listPlaylists();
    const picked = await chooseFromListShell<PickAction>({
      title: "Add to playlist",
      subtitle: item.title,
      actionContext,
      options: [
        ...playlists.map((playlist) => ({
          value: { type: "playlist" as const, id: playlist.id, name: playlist.name },
          label: playlist.name,
          detail: playlist.description,
        })),
        {
          value: { type: "create" as const },
          label: "Create new playlist",
          detail: "Start an empty playlist and add this title",
        },
        { value: { type: "cancel" as const }, label: "Cancel" },
      ],
    });

    if (!picked || picked.type === "cancel") return null;

    const playlist =
      picked.type === "create"
        ? durablePlaylistService.createPlaylist(`Playlist ${new Date().toISOString().slice(0, 10)}`)
        : { id: picked.id, name: picked.name };

    durablePlaylistService.addItem(playlist.id, {
      titleId: item.titleId,
      mediaKind: item.mediaKind,
      title: item.title,
      season: item.season,
      episode: item.episode,
      absoluteEpisode: item.absoluteEpisode,
      providerHints: item.providerHints,
    });

    return { playlistId: playlist.id, playlistName: playlist.name };
  }
}
