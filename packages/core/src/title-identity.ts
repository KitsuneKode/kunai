import type { MediaKind, ProviderExternalIds, ProviderId, TitleIdentity } from "@kunai/types";

import type { ProviderCatalogIdentity } from "./provider-manifest";

export type TitleIdentityInput = {
  readonly id: string;
  readonly kind: MediaKind;
  readonly title: string;
  readonly year?: number;
  readonly externalIds?: ProviderExternalIds;
};

/** Stable catalog key for history, continue-watching, and cross-provider merge. */
export function resolveCanonicalCatalogTitleId(
  title: Pick<TitleIdentityInput, "id" | "kind" | "externalIds">,
): string {
  const { id, kind, externalIds } = title;
  const anilistId = externalIds?.anilistId;
  const tmdbId = externalIds?.tmdbId;
  const malId = externalIds?.malId;

  if (kind === "anime") {
    return anilistId ?? malId ?? id;
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

  const resolvedAnilistId = anilistId ?? (catalogIdentity === "anilist" ? resolvedId : undefined);
  const resolvedTmdbId = tmdbId ?? (catalogIdentity === "tmdb" ? resolvedId : undefined);
  const resolvedExternalIds = compactExternalIds({
    anilistId: resolvedAnilistId,
    tmdbId: resolvedTmdbId,
    imdbId,
    malId,
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

function compactExternalIds(externalIds: ProviderExternalIds): ProviderExternalIds | undefined {
  const providerNativeIds = compactProviderNativeIds(externalIds.providerNativeIds);
  const compact = {
    anilistId: externalIds.anilistId || undefined,
    tmdbId: externalIds.tmdbId || undefined,
    imdbId: externalIds.imdbId || undefined,
    malId: externalIds.malId || undefined,
    ...(providerNativeIds ? { providerNativeIds } : {}),
  };
  return compact.anilistId ||
    compact.tmdbId ||
    compact.imdbId ||
    compact.malId ||
    compact.providerNativeIds
    ? compact
    : undefined;
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
