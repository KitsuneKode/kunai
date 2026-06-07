// =============================================================================
// details-view.ts — pure view-model logic for the [i] Details sheet
//
// Maps a TitleDetail domain object into presentable rows + strings with no
// UI or I/O. Pure and independently testable.
// =============================================================================

import type { TitleDetail, TitleStatus } from "@/domain/catalog/title-detail";

import { wrapText } from "./shell-text";

// ---------------------------------------------------------------------------
// Fact rows
// ---------------------------------------------------------------------------

export type DetailFactRow = {
  readonly label: string;
  readonly value: string;
  /** Tone encodes state/health, never identity. */
  readonly tone?: "success" | "warning" | "muted";
};

/** Status badge — dim placeholder when unknown. */
function formatStatus(status: TitleStatus | undefined): {
  text: string;
  tone: DetailFactRow["tone"];
} {
  if (!status || status === "unknown") return { text: "—", tone: "muted" };
  if (status === "airing") return { text: "◉ airing", tone: undefined };
  if (status === "upcoming") return { text: "upcoming", tone: "muted" };
  return { text: "✦ ended", tone: "muted" };
}

function formatRuntime(minutes: number | undefined): string {
  if (!minutes) return "—";
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Up to 3 genres joined; dim placeholder if none. */
function formatGenres(genres: readonly string[] | undefined): string {
  if (!genres || genres.length === 0) return "—";
  return genres.slice(0, 3).join(" · ");
}

/** Up to 2 studios. */
function formatStudios(studios: readonly string[] | undefined): string {
  if (!studios || studios.length === 0) return "—";
  return studios.slice(0, 2).join(" · ");
}

/** Season/episode count summary. */
function formatSeasonsSummary(detail: TitleDetail): string {
  const parts: string[] = [];
  if (detail.seasonCount !== undefined) {
    parts.push(`${detail.seasonCount} season${detail.seasonCount !== 1 ? "s" : ""}`);
  }
  if (detail.episodeCount !== undefined) {
    parts.push(`${detail.episodeCount} eps`);
  }
  return parts.length > 0 ? parts.join(" · ") : "—";
}

/**
 * Build the canonical fact rows for a TitleDetail, always in the same order.
 * Missing fields are rendered as "—" (dim placeholder) — never omitted.
 */
export function buildDetailFactRows(detail: TitleDetail): readonly DetailFactRow[] {
  const rows: DetailFactRow[] = [];

  // Genres
  rows.push({ label: "Genre", value: formatGenres(detail.genres) });

  // Studio
  if (detail.type !== "movie" || detail.studios) {
    rows.push({ label: "Studio", value: formatStudios(detail.studios) });
  }

  // Year
  rows.push({ label: "Year", value: detail.year ?? "—" });

  // Runtime (only if movie or has value)
  if (detail.type === "movie" || detail.runtimeMinutes !== undefined) {
    rows.push({ label: "Runtime", value: formatRuntime(detail.runtimeMinutes) });
  }

  // Rating / content rating
  if (detail.contentRating) {
    rows.push({ label: "Rating", value: detail.contentRating });
  }

  // Status
  const { text: statusText, tone: statusTone } = formatStatus(detail.status);
  rows.push({ label: "Status", value: statusText, tone: statusTone });

  // Seasons/episodes (series only)
  if (detail.type === "series") {
    rows.push({ label: "Seasons", value: formatSeasonsSummary(detail) });
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Cast formatting
// ---------------------------------------------------------------------------

export type DetailCastLine = {
  readonly name: string;
  readonly role: string | undefined;
  readonly kind: "actor" | "voice";
};

/** Top N cast members for the surface (capped to avoid overwhelming the sheet). */
export function buildDetailCastLines(detail: TitleDetail, maxCast = 6): readonly DetailCastLine[] {
  if (!detail.cast || detail.cast.length === 0) return [];
  return detail.cast.slice(0, maxCast).map((member) => ({
    name: member.name,
    role: member.role,
    kind: member.kind,
  }));
}

// ---------------------------------------------------------------------------
// Synopsis wrapping
// ---------------------------------------------------------------------------

/** Wrap synopsis to `width` columns, capped to `maxLines`. */
export function wrapSynopsis(
  synopsis: string | undefined,
  width: number,
  maxLines: number,
): readonly string[] {
  if (!synopsis) return [];
  return wrapText(synopsis, width, maxLines);
}

// ---------------------------------------------------------------------------
// Poster URL resolution
// ---------------------------------------------------------------------------

/** Pull the best available poster URL from the TitleDetail artwork + fallbacks. */
export function resolvePosterUrl(detail: TitleDetail): string | undefined {
  return detail.artwork?.poster ?? undefined;
}

// ---------------------------------------------------------------------------
// Header subtitle line
// ---------------------------------------------------------------------------

/**
 * Short subtitle shown below the title (type · year · rating).
 * Example: "Series · 2024 · TV-MA"
 */
export function buildDetailSubtitle(detail: TitleDetail): string {
  const typeLabel = detail.type === "movie" ? "Movie" : "Series";
  const parts = [typeLabel, detail.year, detail.contentRating].filter(Boolean);
  return parts.join(" · ");
}
