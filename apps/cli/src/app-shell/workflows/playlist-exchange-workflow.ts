import { mkdir, readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { chooseFromListShell, type ListShellActionContext } from "@/app-shell/pickers";
import type { Container } from "@/container";
import type { KunaiPlaylistDocument } from "@/services/playlists/KunaiPlaylistFormat";
import { getKunaiPaths } from "@/services/storage/storage-read-models";

/** Export and import of durable playlists through the app-data exchange folder. */

async function ensurePlaylistExchangeDir(): Promise<string> {
  const dir = join(getKunaiPaths().dataDir, "playlists");
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function exportDurablePlaylist(
  container: Container,
  actionContext: ListShellActionContext,
): Promise<void> {
  const playlists = container.durablePlaylistService.listPlaylists();
  if (playlists.length === 0) {
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note: "No durable playlists to export. Save the queue as a playlist first.",
    });
    return;
  }

  const picked = await chooseFromListShell({
    title: "Export Playlist",
    subtitle: "Exports identity and progress only; never stream URLs or local paths",
    actionContext,
    options: playlists.map((playlist) => ({
      value: playlist.id,
      label: playlist.name,
      detail: playlist.description,
    })),
  });
  if (!picked) return;

  const playlist = playlists.find((item) => item.id === picked);
  if (!playlist) return;
  // The picker promises "identity and progress": feed the playlist's own
  // history rows, or the export silently carries identity alone.
  const titleIds = container.durablePlaylistService
    .listItems(playlist.id)
    .map((item) => item.titleId);
  const progress = container.historyRepository.listByTitleIds(titleIds);
  const document = container.durablePlaylistService.exportPlaylist(
    playlist.id,
    playlist.name,
    progress,
  );
  const dir = await ensurePlaylistExchangeDir();
  const filePath = join(dir, `${safeFileSlug(playlist.name)}.kunai-playlist.json`);
  await Bun.write(filePath, `${JSON.stringify(document, null, 2)}\n`);
  container.stateManager.dispatch({
    type: "SET_PLAYBACK_FEEDBACK",
    note: `Exported playlist to ${filePath}.`,
  });
}

export async function importDurablePlaylist(
  container: Container,
  actionContext: ListShellActionContext,
): Promise<void> {
  const dir = await ensurePlaylistExchangeDir();
  const files = (await readdir(dir)).filter(
    (name) => name.endsWith(".kunai-playlist.json") || name.endsWith(".json"),
  );
  if (files.length === 0) {
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note: `No playlist files found in ${dir}.`,
    });
    return;
  }

  const picked = await chooseFromListShell({
    title: "Import Playlist",
    subtitle: `Choose a Kunai playlist file from ${dir}`,
    actionContext,
    options: files.map((file) => ({
      value: join(dir, file),
      label: basename(file),
    })),
  });
  if (!picked) return;

  const document = parseKunaiPlaylistDocument(await readFile(picked, "utf8"));
  const playlist = container.durablePlaylistService.importPlaylist(document);
  container.stateManager.dispatch({
    type: "SET_PLAYBACK_FEEDBACK",
    note: `Imported "${playlist.name}" without autoplaying anything.`,
  });
}

function parseKunaiPlaylistDocument(json: string): KunaiPlaylistDocument {
  const parsed = JSON.parse(json) as KunaiPlaylistDocument;
  if (parsed.format !== "kunai-playlist" || parsed.version !== 1 || !Array.isArray(parsed.items)) {
    throw new Error("Invalid Kunai playlist document");
  }
  return parsed;
}

function safeFileSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "playlist";
}
