import type { TitleLink } from "@/domain/catalog/title-detail";

/** Map a provider trailer { site, id } to a watchable URL (mpv/browser handle it). */
export function toTrailerUrl(
  trailer: { readonly site?: string | null; readonly id?: string | null } | null | undefined,
): string | undefined {
  const site = trailer?.site?.toLowerCase().trim();
  const id = trailer?.id?.trim();
  if (!site || !id) return undefined;
  if (site === "youtube") return `https://www.youtube.com/watch?v=${id}`;
  if (site === "dailymotion") return `https://www.dailymotion.com/video/${id}`;
  return undefined;
}

function dedupeLinks(links: readonly TitleLink[]): TitleLink[] {
  const seen = new Set<string>();
  const out: TitleLink[] = [];
  for (const link of links) {
    if (!link.label || !link.url || seen.has(link.url)) continue;
    seen.add(link.url);
    out.push(link);
  }
  return out;
}

/** AniList externalLinks (+ a MAL link derived from idMal) → TitleLink[]. */
export function aniListExternalLinks(
  externalLinks:
    | readonly { readonly site?: string | null; readonly url?: string | null }[]
    | undefined,
  idMal: string | undefined,
): TitleLink[] {
  const mapped = (externalLinks ?? []).map((link) => ({
    label: (link.site ?? "").trim(),
    url: (link.url ?? "").trim(),
  }));
  if (idMal) {
    mapped.push({ label: "MyAnimeList", url: `https://myanimelist.net/anime/${idMal}` });
  }
  return dedupeLinks(mapped);
}

/** TMDB homepage + IMDb id → TitleLink[]. */
export function tmdbExternalLinks(
  homepage: string | undefined,
  imdbId: string | undefined,
): TitleLink[] {
  const links: TitleLink[] = [];
  if (homepage?.trim()) links.push({ label: "Website", url: homepage.trim() });
  if (imdbId?.trim()) {
    links.push({ label: "IMDb", url: `https://www.imdb.com/title/${imdbId.trim()}/` });
  }
  return dedupeLinks(links);
}
