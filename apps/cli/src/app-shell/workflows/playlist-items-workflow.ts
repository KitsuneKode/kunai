import { chooseFromListShell, type ListShellActionContext } from "@/app-shell/pickers";
import type { Container } from "@/container";

type ItemRecord = ReturnType<Container["durablePlaylistService"]["listItems"]>[number];

/** `S1E2`, `E12`, or nothing for a movie, so two episodes of one show are distinguishable. */
export function playlistItemLabel(item: ItemRecord): string {
  if (item.season !== undefined && item.episode !== undefined) {
    return `${item.title} · S${item.season}E${item.episode}`;
  }
  if (item.episode !== undefined) return `${item.title} · E${item.episode}`;
  return item.title;
}

/**
 * See and change what a saved playlist holds. Playlists could be created,
 * renamed, loaded and deleted, but once an item was in one it could neither be
 * removed nor moved: the service had `removeItem` with no caller at all.
 */
export async function editPlaylistItems(
  container: Container,
  playlist: { readonly id: string; readonly name: string },
  actionContext: ListShellActionContext,
): Promise<void> {
  const service = container.durablePlaylistService;
  let focusId: string | undefined;

  while (true) {
    const items = service.listItems(playlist.id);
    if (items.length === 0) {
      container.stateManager.dispatch({
        type: "SET_PLAYBACK_FEEDBACK",
        note: `"${playlist.name}" is empty. Add titles from browse, history or details.`,
      });
      return;
    }
    const focusIndex = Math.max(
      0,
      items.findIndex((item) => item.id === focusId),
    );
    const picked = await chooseFromListShell<string | null>({
      title: `Edit "${playlist.name}"`,
      subtitle: `${items.length} item${items.length === 1 ? "" : "s"} · pick one to move or remove`,
      actionContext,
      initialSelectedIndex: focusIndex,
      options: [
        ...items.map((item, index) => ({
          value: item.id,
          label: `${index + 1}. ${playlistItemLabel(item)}`,
        })),
        { value: null, label: "Done" },
      ],
    });
    if (!picked) return;
    const item = items.find((candidate) => candidate.id === picked);
    if (!item) return;
    focusId = item.id;
    const index = items.indexOf(item);

    const action = await chooseFromListShell({
      title: playlistItemLabel(item),
      subtitle: `Position ${index + 1} of ${items.length} in "${playlist.name}"`,
      actionContext,
      options: [
        {
          value: "up" as const,
          label: "Move up",
          disabled: index === 0,
          detail: index === 0 ? "Already first" : undefined,
        },
        {
          value: "down" as const,
          label: "Move down",
          disabled: index === items.length - 1,
          detail: index === items.length - 1 ? "Already last" : undefined,
        },
        {
          value: "remove" as const,
          label: "Remove from playlist",
          detail: "Only this playlist changes; history and Up Next are untouched",
          destructive: true,
        },
        { value: "back" as const, label: "Back" },
      ],
    });
    if (action === "up" || action === "down") {
      service.moveItem(playlist.id, item.id, action === "up" ? -1 : 1);
    } else if (action === "remove") {
      const confirmed = await chooseFromListShell({
        title: `Remove ${playlistItemLabel(item)}?`,
        subtitle: `From "${playlist.name}" only`,
        actionContext,
        options: [
          { value: true, label: "Remove", destructive: true },
          { value: false, label: "Keep" },
        ],
      });
      if (!confirmed) continue;
      service.removeItem(item.id);
      focusId = items[index + 1]?.id ?? items[index - 1]?.id;
      container.stateManager.dispatch({
        type: "SET_PLAYBACK_FEEDBACK",
        note: `Removed ${playlistItemLabel(item)} from "${playlist.name}".`,
      });
    }
  }
}
