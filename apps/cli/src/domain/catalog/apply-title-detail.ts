// =============================================================================
// apply-title-detail.ts — adopt resolved catalog facts into the session title
//
// A `-i/--id` launch (and a share ref that carries no title) has an id and
// nothing else, so the session runs on a placeholder `TitleInfo` until the
// catalog answers. This is the single place that answer is folded back in.
//
// It matters because the placeholder is not merely rendered: the working
// `TitleInfo` is what history, the playback ledger, Discord presence, and
// generated share links all persist and broadcast. Upgrading only the session
// reducer left the panel showing "Dune" while the database — and anyone the
// share link reached — recorded "TMDB 438631" with no poster and no ids.
//
// Adoption is additive and never destructive: a name the user actually searched
// for, a poster the provider supplied, and ids the title already carries all
// win over the catalog. Only gaps are filled.
// =============================================================================

import { resolveCatalogPosterUrl } from "@/domain/catalog/resolve-catalog-poster-url";
import type { TitleDetail } from "@/domain/catalog/title-detail";
import { upgradeTitleInfoStructure } from "@/domain/media/anilist-format";
import { isPlaceholderTitleName } from "@/domain/types";
import type { TitleInfo } from "@/domain/types";
import { mergeBackfillExternalIds } from "@kunai/core";
import type { ProviderExternalIds } from "@kunai/types";

/** Writable view of the fields this module fills in, assembled then frozen by spread. */
type TitleInfoPatch = { -readonly [K in keyof TitleInfo]?: TitleInfo[K] };

/**
 * Fold a resolved {@link TitleDetail} into the {@link TitleInfo} the session is
 * running on. Returns `title` unchanged when the detail describes a different
 * title or adds nothing, so callers can assign the result unconditionally.
 */
export function applyCatalogDetailToTitle(title: TitleInfo, detail: TitleDetail): TitleInfo {
  if (detail.id !== title.id) return title;

  // Structure first: a film that arrived typed as a series loses its episode
  // count here, so the gap-filling below never restores one.
  const structured = upgradeTitleInfoStructure(title, detail.type);
  const patch: TitleInfoPatch = {};

  const resolvedName = detail.title.trim();
  if (resolvedName && isPlaceholderTitleName(structured.name, structured.id)) {
    patch.name = resolvedName;
  }

  if (!structured.posterUrl) {
    const poster = resolveCatalogPosterUrl(detail.artwork?.poster);
    if (poster) patch.posterUrl = poster;
  }

  const externalIds = mergeBackfillExternalIds(structured.externalIds, detail.externalIds);
  if (!sameExternalIds(externalIds, structured.externalIds)) {
    patch.externalIds = externalIds;
  }

  if (!structured.year && detail.year) {
    patch.year = detail.year;
  }

  if (structured.type !== "movie" && structured.episodeCount === undefined && detail.episodeCount) {
    patch.episodeCount = detail.episodeCount;
  }

  if (Object.keys(patch).length === 0) return structured;
  return { ...structured, ...patch };
}

/** Value equality — the merge helper always allocates, so identity says nothing. */
function sameExternalIds(
  left: ProviderExternalIds | undefined,
  right: ProviderExternalIds | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return JSON.stringify(sortEntries(left)) === JSON.stringify(sortEntries(right));
}

function sortEntries(ids: ProviderExternalIds): readonly (readonly [string, unknown])[] {
  return Object.entries(ids)
    .filter(([, value]) => value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => [key, value] as const);
}
