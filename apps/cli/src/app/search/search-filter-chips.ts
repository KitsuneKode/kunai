import type { BrowseLibraryFilterAvailability } from "@/app/search/browse-local-filter-facts";
import type { ShellMode } from "@/domain/types";

export type SearchFilterChipOption = {
  readonly value: string | null;
  readonly label: string;
  readonly detail: string;
};

/**
 * Guided-facet chips for the `/filters` sheet. Type facets are gated to the
 * current catalog mode so we never advertise a token that cannot apply — e.g.
 * `type:playlist` only surfaces in YouTube mode, and `type:movie|series` only
 * outside YouTube. This keeps the sheet honest with what the routing layer will
 * actually apply (see SearchRoutingService content-shape gating).
 */
export function buildSearchFilterChipOptions(context: {
  readonly sessionMode: ShellMode;
  readonly library: BrowseLibraryFilterAvailability;
}): SearchFilterChipOption[] {
  const { sessionMode, library } = context;
  const isYoutube = sessionMode === "youtube";

  return [
    // ── Type (catalog-scoped) ──
    ...(isYoutube
      ? [
          { value: "type:video", label: "YouTube · Videos", detail: "Only videos" },
          { value: "type:playlist", label: "YouTube · Playlists", detail: "Only playlists" },
          { value: "type:channel", label: "YouTube · Channels", detail: "Only channels" },
        ]
      : [
          { value: "type:movie", label: "Type · Movies", detail: "Only movies" },
          { value: "type:series", label: "Type · Series", detail: "Only TV / series" },
        ]),
    // ── Cross-mode switches (skip the one you are already in) ──
    ...(sessionMode !== "anime"
      ? [{ value: "mode:anime", label: "Type · Anime", detail: "Search anime catalogs" }]
      : []),
    ...(sessionMode !== "youtube"
      ? [{ value: "mode:youtube", label: "Type · YouTube", detail: "Search YouTube" }]
      : []),
    // ── Genre (anime catalogs honor these directly) ──
    { value: "genre:action", label: "Genre · Action", detail: "" },
    { value: "genre:adventure", label: "Genre · Adventure", detail: "" },
    { value: "genre:comedy", label: "Genre · Comedy", detail: "" },
    { value: "genre:drama", label: "Genre · Drama", detail: "" },
    { value: "genre:fantasy", label: "Genre · Fantasy", detail: "" },
    { value: "genre:horror", label: "Genre · Horror", detail: "" },
    { value: "genre:mystery", label: "Genre · Mystery", detail: "" },
    { value: "genre:romance", label: "Genre · Romance", detail: "" },
    { value: "genre:supernatural", label: "Genre · Supernatural", detail: "" },
    { value: "genre:thriller", label: "Genre · Thriller", detail: "" },
    { value: "genre:sports", label: "Genre · Sports", detail: "" },
    { value: "genre:mecha", label: "Genre · Mecha", detail: "" },
    // ── Year ──
    { value: "year:2025", label: "Year · 2025", detail: "" },
    { value: "year:2024", label: "Year · 2024", detail: "" },
    { value: "year:2023", label: "Year · 2023", detail: "" },
    { value: "year:2022", label: "Year · 2022", detail: "" },
    { value: "year:2020", label: "Year · 2020", detail: "" },
    ...(library.release
      ? [
          { value: "release:today", label: "Release · Today", detail: "Releasing today" },
          {
            value: "release:this-week",
            label: "Release · This week",
            detail: "Airing this week",
          },
          { value: "release:upcoming", label: "Release · Upcoming", detail: "Not yet aired" },
        ]
      : []),
    // ── Rating ──
    { value: "rating:9", label: "Rating · 9+", detail: "Top rated" },
    { value: "rating:8", label: "Rating · 8+", detail: "Highly rated" },
    { value: "rating:7", label: "Rating · 7+", detail: "Well rated" },
    ...(library.watched
      ? [
          {
            value: "watched:watching",
            label: "Library · Continue watching",
            detail: "In-progress",
          },
          { value: "watched:completed", label: "Library · Completed", detail: "Finished" },
          { value: "watched:unwatched", label: "Library · Unwatched", detail: "Not started" },
        ]
      : []),
    ...(library.downloaded
      ? [
          {
            value: "downloaded:true",
            label: "Library · Downloaded",
            detail: "Available offline",
          },
        ]
      : []),
    // ── Sort ──
    { value: "sort:popular", label: "Sort · Popular", detail: "" },
    { value: "sort:rating", label: "Sort · Top rated", detail: "" },
    { value: "sort:recent", label: "Sort · Recent", detail: "" },
    // ── Advanced (edit the code after inserting) ──
    { value: "audio:ja", label: "Audio · Japanese", detail: "Edit code: ja/en/hi/de…" },
    { value: "subtitles:en", label: "Subtitles · English", detail: "Edit code: en/es/ja…" },
    {
      value: "provider:allanime",
      label: "Provider · …",
      detail: "Edit provider id after insert",
    },
    { value: null, label: "Cancel", detail: "" },
  ];
}
