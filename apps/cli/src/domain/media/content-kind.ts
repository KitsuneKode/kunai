// =============================================================================
// content-kind.ts — derive content kind (and the matching language profile) from
// content truth, not ShellMode.
//
// ShellMode ("series" | "anime") is provider routing only and must never decide
// content labels. Content kind is the title's ContentType ("movie" | "series"),
// with "anime" distinguished by mode. Lives in domain/ alongside playable-ref so
// both the shell (app-shell/) and phases (app/) reuse one source of truth.
// =============================================================================

import type { ShellMode, TitleInfo } from "@/domain/types";
import type { MediaLanguageProfile } from "@/services/persistence/ConfigService";

export type ContentKind = "movie" | "series" | "anime";

/** Content kind for display: movie wins by content type; anime by mode; else series. */
export function resolveContentKind(
  title: Pick<TitleInfo, "type"> | null | undefined,
  mode: ShellMode,
): ContentKind {
  if (title?.type === "movie") return "movie";
  return mode === "anime" ? "anime" : "series";
}

/** Movies have no season/episode — never render an S·E label for them. */
export function showsEpisodeLabel(title: Pick<TitleInfo, "type"> | null | undefined): boolean {
  return title?.type !== "movie";
}

/** Pick the language profile (audio/subtitle/quality) matching the content kind. */
export function mediaLanguageProfileFor(input: {
  readonly mode: ShellMode;
  readonly currentTitle: Pick<TitleInfo, "type"> | null;
  readonly animeLanguageProfile: MediaLanguageProfile;
  readonly seriesLanguageProfile: MediaLanguageProfile;
  readonly movieLanguageProfile: MediaLanguageProfile;
}): MediaLanguageProfile {
  const kind = resolveContentKind(input.currentTitle, input.mode);
  if (kind === "anime") return input.animeLanguageProfile;
  if (kind === "movie") return input.movieLanguageProfile;
  return input.seriesLanguageProfile;
}
