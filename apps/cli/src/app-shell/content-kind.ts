// =============================================================================
// content-kind.ts — derive display content kind from content truth, not mode
//
// ShellMode ("series" | "anime") is provider routing only and must never decide
// content labels. Content kind is the title's ContentType ("movie" | "series"),
// with "anime" distinguished by mode. This is the display half of the Plan C
// mediaKind decouple — a movie never renders as "series" or shows an S·E label.
// =============================================================================

import type { ShellMode, TitleInfo } from "@/domain/types";

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
