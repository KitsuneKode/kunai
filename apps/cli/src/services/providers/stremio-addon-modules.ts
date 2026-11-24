import {
  isStremioAddonInstalled,
  readInstalledStremioAddons,
  type InstalledStremioAddon,
} from "@/domain/provider/stremio-addons";
import { fetchTmdbJsonWithFallback, TmdbHttpError } from "@/services/catalog/tmdb-proxy";
import type { StremioAddonConfigEntry } from "@kunai/config";
import type { CoreProviderModule } from "@kunai/core";
import {
  createStremioAddonProviderModule,
  isImdbTitleId,
  type StremioImdbIdResolver,
} from "@kunai/providers/stremio-addon";
import { isJsonObject, isJsonString } from "@kunai/types";

/**
 * The IMDb id TMDB records for one of its own titles.
 *
 * TMDB's `external_ids` is an exact id-to-id record, which is the only kind of
 * mapping an addon request may be built from: a title match can land on a
 * remake or a same-named film and play the wrong one. `null` means TMDB has the
 * title and no IMDb id for it; a failed request rejects instead, so "could not
 * ask" is never mistaken for "does not exist".
 */
export const resolveImdbIdFromTmdb: StremioImdbIdResolver = async ({
  tmdbId,
  mediaKind,
  signal,
}) => {
  const path = `/${mediaKind === "movie" ? "movie" : "tv"}/${tmdbId}/external_ids`;
  let body: unknown;
  try {
    body = await fetchTmdbJsonWithFallback(path, signal);
  } catch (error) {
    if (error instanceof TmdbHttpError && error.status === 404) return null;
    throw error;
  }
  const imdbId = isJsonObject(body) ? body.imdb_id : undefined;
  return isJsonString(imdbId) && isImdbTitleId(imdbId) ? imdbId : null;
};

export interface StremioAddonModuleHost {
  /** The stored list right now. Read on every resolve, so a removal is honoured at once. */
  readonly getEntries: () => readonly StremioAddonConfigEntry[];
  /**
   * Whether the experimental addon feature is on right now. Read through
   * `isInstalled` on every addon contact, so a standalone `kunai addons
   * disable` stops an already-running session at the next resolve.
   */
  readonly isEnabled?: () => boolean;
  readonly resolveImdbId?: StremioImdbIdResolver;
  /** The addon's manifest named it differently from what is stored. */
  readonly onName?: (addon: InstalledStremioAddon, name: string) => void;
}

/**
 * One provider module per installed addon, in the order they were added.
 *
 * Built from the stored URLs alone. No addon is contacted here, so an addon
 * that is slow or gone cannot delay startup; each one is first asked when a
 * title is resolved through it.
 */
export function createStremioAddonModules(host: StremioAddonModuleHost): CoreProviderModule[] {
  return readInstalledStremioAddons(host.getEntries()).map((addon) =>
    createStremioAddonProviderModule({
      addon,
      name: addon.displayName,
      isInstalled: () =>
        (host.isEnabled?.() ?? true) &&
        isStremioAddonInstalled(host.getEntries(), addon.providerId),
      resolveImdbId: host.resolveImdbId ?? resolveImdbIdFromTmdb,
      onManifest: (manifest) => {
        if (manifest.name !== addon.entry.name) host.onName?.(addon, manifest.name);
      },
    }),
  );
}
