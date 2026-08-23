import type { MediaKind, ProviderExternalIds, ProviderId, TitleIdentity } from "@kunai/types";

import type { ProviderCatalogIdentity } from "./provider-manifest";

export type TitleIdentityInput = {
  readonly id: string;
  readonly kind: MediaKind;
  readonly title: string;
  readonly year?: number;
  readonly externalIds?: ProviderExternalIds;
};

export type CanonicalTitleIdOptions = {
  /**
   * Content classification from the caller's richer signals (AniList/MAL id,
   * deterministic anime tag, anime-only provider). "anime" lets an anime work
   * that arrived through the TMDB/series lane keep its AniList/MAL history unit;
   * pure western series (no anime ids) are never forced. Defaults to "general",
   * which preserves the kind-driven rules exactly.
   */
  readonly contentClass?: "anime" | "general";
};

/** Stable catalog key for history, continue-watching, and cross-provider merge. */
export function resolveCanonicalCatalogTitleId(
  title: Pick<TitleIdentityInput, "id" | "kind" | "externalIds">,
  options?: CanonicalTitleIdOptions,
): string {
  const { id, kind, externalIds } = title;
  const anilistId = externalIds?.anilistId;
  const tmdbId = externalIds?.tmdbId;
  const malId = externalIds?.malId;

  if (kind === "anime") {
    return anilistId ?? malId ?? id;
  }

  if (options?.contentClass === "anime" && kind !== "video" && (anilistId || malId)) {
    return anilistId ?? malId ?? id;
  }

  if (kind === "video") {
    const youtubeId = externalIds?.youtubeId;
    if (youtubeId) {
      return id.startsWith("youtube:") ? id : `youtube:${youtubeId}`;
    }
    return id;
  }

  if ((kind === "movie" || kind === "series") && tmdbId) {
    if (id === `tmdb:${tmdbId}` || id === tmdbId) {
      return id.startsWith("tmdb:") ? id : `tmdb:${tmdbId}`;
    }
    return id.startsWith("tmdb:") ? id : `tmdb:${tmdbId}`;
  }

  if (tmdbId) {
    return id.startsWith("tmdb:") ? id : `tmdb:${tmdbId}`;
  }

  return anilistId ?? malId ?? id;
}

/** Canonical title id for history / prefs / continuation lookups (alias for clarity at call sites). */
export function resolveHistoryLookupTitleId(
  title: Pick<TitleIdentityInput, "id" | "kind" | "externalIds">,
): string {
  return resolveCanonicalCatalogTitleId(title);
}

export function looksLikeOpaqueProviderNativeId(
  id: string,
  externalIds?: ProviderExternalIds,
): boolean {
  const normalized = id.replace(/^allanime:/, "").trim();
  if (!normalized) return false;
  const anilistId = externalIds?.anilistId;
  if (anilistId && normalized === anilistId) return false;
  return !/^\d+$/.test(normalized);
}

export function mergeProviderNativeId(
  externalIds: ProviderExternalIds | undefined,
  providerId: string,
  nativeId: string,
): ProviderExternalIds | undefined {
  const trimmed = nativeId.replace(/^allanime:/, "").trim();
  if (!trimmed) return externalIds;

  const providerKey = providerId as ProviderId;
  const existing = externalIds?.providerNativeIds?.[providerKey];
  if (existing === trimmed) return externalIds;

  return compactExternalIds({
    ...externalIds,
    providerNativeIds: {
      ...externalIds?.providerNativeIds,
      [providerKey]: trimmed,
    },
  });
}

/** History row title identity: canonical catalog id + merged provider-native map. */
export function resolvePersistedHistoryTitle(
  title: TitleIdentityInput,
  providerId: string,
): TitleIdentityInput {
  const canonicalId = resolveCanonicalCatalogTitleId(title);
  const storedNative = title.externalIds?.providerNativeIds?.[providerId as ProviderId];
  const sessionNative =
    storedNative ??
    (title.id !== canonicalId && looksLikeOpaqueProviderNativeId(title.id, title.externalIds)
      ? title.id.replace(/^allanime:/, "").trim()
      : undefined);

  const externalIds = sessionNative
    ? mergeProviderNativeId(title.externalIds, providerId, sessionNative)
    : title.externalIds;

  return {
    ...title,
    id: canonicalId,
    externalIds,
  };
}

/** Merge healed catalog metadata without clobbering existing catalog ids. */
export function mergeBackfillExternalIds(
  existing: ProviderExternalIds | undefined,
  incoming: ProviderExternalIds | undefined,
): ProviderExternalIds | undefined {
  if (!incoming) return existing;
  return compactExternalIds({
    anilistId: existing?.anilistId ?? incoming.anilistId,
    tmdbId: existing?.tmdbId ?? incoming.tmdbId,
    imdbId: existing?.imdbId ?? incoming.imdbId,
    malId: existing?.malId ?? incoming.malId,
    youtubeId: existing?.youtubeId ?? incoming.youtubeId,
    youtubeChannelId: existing?.youtubeChannelId ?? incoming.youtubeChannelId,
    youtubePlaylistId: existing?.youtubePlaylistId ?? incoming.youtubePlaylistId,
    providerNativeIds: {
      ...existing?.providerNativeIds,
      ...incoming.providerNativeIds,
    },
  });
}

/** Pick the provider-facing title id and catalog fields from stored title + provider catalog kind. */
export function resolveProviderTitleIdentity(
  title: TitleIdentityInput,
  catalogIdentity: ProviderCatalogIdentity,
  providerId?: string,
): TitleIdentity {
  const externalIds = title.externalIds;
  const anilistId = externalIds?.anilistId;
  const tmdbId = externalIds?.tmdbId;
  const imdbId = externalIds?.imdbId;
  const malId = externalIds?.malId;
  const storedNative =
    providerId !== undefined
      ? externalIds?.providerNativeIds?.[providerId as ProviderId]
      : undefined;

  let resolvedId = title.id;
  switch (catalogIdentity) {
    case "anilist":
      resolvedId = anilistId ?? title.id;
      break;
    case "tmdb":
      resolvedId = tmdbId ?? title.id;
      break;
    case "provider-native":
      if (storedNative) {
        resolvedId = storedNative;
      } else if (looksLikeOpaqueProviderNativeId(title.id, externalIds)) {
        resolvedId = title.id.replace(/^allanime:/, "").trim();
      } else {
        resolvedId = title.id;
      }
      break;
  }

  // A catalog's own id space is numeric. Without this guard an opaque provider
  // id (e.g. an AllAnime show id) carried on a title with no external ids would
  // be laundered into the anilistId/tmdbId slot purely because the active
  // provider declares that catalog identity.
  const resolvedAnilistId =
    anilistId ?? (catalogIdentity === "anilist" ? asCatalogId(resolvedId) : undefined);
  const resolvedTmdbId =
    tmdbId ?? (catalogIdentity === "tmdb" ? asCatalogId(resolvedId) : undefined);
  const resolvedExternalIds = compactExternalIds({
    anilistId: resolvedAnilistId,
    tmdbId: resolvedTmdbId,
    imdbId,
    malId,
    youtubeId: externalIds?.youtubeId,
    youtubeChannelId: externalIds?.youtubeChannelId,
    youtubePlaylistId: externalIds?.youtubePlaylistId,
    providerNativeIds: externalIds?.providerNativeIds,
  });

  return {
    id: resolvedId,
    kind: title.kind,
    title: title.title,
    year: title.year,
    anilistId: resolvedAnilistId,
    tmdbId: resolvedTmdbId,
    imdbId,
    malId,
    externalIds: resolvedExternalIds,
  };
}

/** AniList and TMDB ids are numeric; anything else is a foreign id space. */
function asCatalogId(value: string): string | undefined {
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? trimmed : undefined;
}

function compactExternalIds(externalIds: ProviderExternalIds): ProviderExternalIds | undefined {
  const providerNativeIds = compactProviderNativeIds(externalIds.providerNativeIds);
  const compact: ProviderExternalIds = {
    ...(externalIds.anilistId ? { anilistId: externalIds.anilistId } : {}),
    ...(externalIds.tmdbId ? { tmdbId: externalIds.tmdbId } : {}),
    ...(externalIds.imdbId ? { imdbId: externalIds.imdbId } : {}),
    ...(externalIds.malId ? { malId: externalIds.malId } : {}),
    ...(externalIds.youtubeId ? { youtubeId: externalIds.youtubeId } : {}),
    ...(externalIds.youtubeChannelId ? { youtubeChannelId: externalIds.youtubeChannelId } : {}),
    ...(externalIds.youtubePlaylistId ? { youtubePlaylistId: externalIds.youtubePlaylistId } : {}),
    ...(providerNativeIds ? { providerNativeIds } : {}),
  };
  return Object.keys(compact).length > 0 ? compact : undefined;
}

function compactProviderNativeIds(
  providerNativeIds: ProviderExternalIds["providerNativeIds"],
): ProviderExternalIds["providerNativeIds"] | undefined {
  if (!providerNativeIds) return undefined;
  const compact: Partial<Record<ProviderId, string>> = {};
  for (const [providerId, nativeId] of Object.entries(providerNativeIds)) {
    const trimmed = nativeId?.trim();
    if (!trimmed) continue;
    compact[providerId as ProviderId] = trimmed;
  }
  return Object.keys(compact).length > 0 ? compact : undefined;
}

/**
 * Stand-in name for a title launched by `-i/--id` before the catalog answers.
 *
 * `-i 438631 -t movie` has an id and nothing else, so the session needs *some*
 * name to render. Kept here, beside its recogniser, because both the CLI (which
 * mints it) and storage (which must refuse to persist it over a real name) have
 * to agree on the exact shape.
 */
export function directIdTitleName(id: string): string {
  return `TMDB ${id}`;
}

/** True while a title still carries the `-i` placeholder rather than a real name. */
export function isDirectIdTitleName(name: string, id: string): boolean {
  return name.trim() === directIdTitleName(id);
}

/**
 * True while a name is a stand-in for the id rather than something a catalog or
 * a user supplied — safe to replace the moment real detail arrives, and never
 * worth persisting over a name already stored.
 *
 * Two lanes produce one: `-i/--id` writes {@link directIdTitleName}, and a share
 * ref with no title falls back to the id itself (`tmdb:438631`). Both are the id
 * wearing a name.
 */
export function isPlaceholderTitleName(name: string, id: string): boolean {
  const trimmed = name.trim();
  return trimmed === directIdTitleName(id) || trimmed === id.trim();
}
