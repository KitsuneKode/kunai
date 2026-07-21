// =============================================================================
// media-panel-model.ts — ONE content-kind-aware view-model for the media panel
//
// Both Now Playing and Post-play render the same `MediaPanel` from this model,
// so movie / series / anime / video share one tasteful layout. A new kind plugs
// in by adding a `buildXPanel` branch + a `ContentKind` value — never a new
// rail component. Pure; no I/O, no React.
//
// Slots are kind-agnostic: header (title + secondary line), kindBadge, facts
// (aligned label/value rows), synopsis (clamped), miniCards (resume/prev/next),
// poster (season-aware art), progress. Per-kind builders only decide WHAT fills
// each slot; the component decides HOW it renders.
// =============================================================================

import type { TitleDetail } from "@/domain/catalog/title-detail";
import type { ContentKind } from "@/domain/media/content-kind";
import type { VideoMeta } from "@/domain/types";

import { resolveEpisodeThumbUrl, resolveSeasonAwarePosterUrl } from "./media-art";

// ── Model ──────────────────────────────────────────────────────────────────

export type MediaPanelFact = {
  readonly label: string;
  readonly value: string;
  readonly tone?: "success" | "muted";
};

export type MediaPanelMiniCardKind = "resume" | "prev" | "next";

export type MediaPanelMiniCard = {
  readonly kind: MediaPanelMiniCardKind;
  /** Section label shown above the card ("up next", "prev", "resume"). */
  readonly section: string;
  readonly label: string;
  readonly meta?: string;
  readonly thumbUrl?: string;
};

export type MediaPanelProgress = {
  readonly percent: number;
  readonly label: string;
};

export type MediaPanelModel = {
  readonly kind: ContentKind;
  readonly kindBadge: string;
  readonly posterUrl?: string;
  readonly title: string;
  readonly secondary?: string;
  readonly facts: readonly MediaPanelFact[];
  readonly synopsis?: string;
  readonly miniCards: readonly MediaPanelMiniCard[];
  readonly progress?: MediaPanelProgress;
};

// ── Context (input) ──────────────────────────────────────────────────────────

export type MediaPanelSurface = "playing" | "post-play";

export type MediaPanelContext = {
  readonly surface: MediaPanelSurface;
  readonly contentKind: ContentKind;
  readonly title: string;
  readonly titleDetail?: TitleDetail;
  readonly videoMeta?: VideoMeta | null;
  /** Title-level poster fallback (catalog posterUrl / video thumbnail). */
  readonly posterUrl?: string;
  readonly currentSeason?: number;
  readonly currentEpisode?: number;
  /** Episodic next/prev labels (provider/catalog shaped, e.g. "S01 E12 — Inversion"). */
  readonly nextEpisodeLabel?: string;
  readonly nextEpisodeThumbUrl?: string;
  readonly previousEpisodeLabel?: string;
  readonly previousEpisodeThumbUrl?: string;
  /** Cross-title queue head; used when there is no episode-chain next. */
  readonly queueNextLabel?: string;
  /** Post-play stopped-early resume target. */
  readonly resumeLabel?: string;
  readonly autoplayPaused?: boolean;
  readonly progress?: { readonly watched: number; readonly total: number };
};

// ── Humanizers ─────────────────────────────────────────────────────────────

export function formatViewCount(count: number | undefined): string | undefined {
  if (count === undefined || !Number.isFinite(count) || count < 0) return undefined;
  if (count < 1_000) return `${count} views`;
  if (count < 1_000_000) return `${trimZero(count / 1_000)}K views`;
  if (count < 1_000_000_000) return `${trimZero(count / 1_000_000)}M views`;
  return `${trimZero(count / 1_000_000_000)}B views`;
}

function trimZero(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function formatRelativeTime(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return undefined;
  const ms = Date.now() - then;
  if (ms < 0) return undefined;
  const days = Math.floor(ms / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

export function formatDurationClock(seconds: number | undefined): string | undefined {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return undefined;
  const total = Math.round(seconds);
  const h = Math.floor(total / 3_600);
  const m = Math.floor((total % 3_600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function formatRuntimeMinutes(minutes: number | undefined): string | undefined {
  if (minutes === undefined || !Number.isFinite(minutes) || minutes <= 0) return undefined;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

function formatScore(score: number | undefined): string | undefined {
  if (score === undefined || !Number.isFinite(score) || score <= 0) return undefined;
  return `★ ${score.toFixed(1)}`;
}

function padSE(value: number | undefined): string | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return String(value).padStart(2, "0");
}

/** "S01 E06 — Challengers" / "S01E06 — Title" → "E06 · Challengers"; numeric-only names collapse to the tag. */
export function formatEpisodeCardLabel(label: string | undefined): string | undefined {
  const trimmed = label?.trim();
  if (!trimmed) return undefined;
  const match = trimmed.match(/^S\d+\s*(E\d+)\s*[—–-]\s*(.+)$/iu);
  if (match) {
    const tag = match[1] ?? "";
    const name = match[2]?.trim() ?? "";
    if (!name || /^episode\s+\d+$/iu.test(name)) return tag || trimmed;
    return `${tag} · ${name}`;
  }
  return trimmed;
}

function autoplayMeta(autoplayPaused: boolean | undefined, runtime?: string): string {
  const parts = [autoplayPaused ? "autoplay paused" : "autoplay"];
  if (runtime) parts.unshift(runtime);
  return parts.join(" · ");
}

// ── Status helpers ────────────────────────────────────────────────────────

function statusLabel(detail: TitleDetail | undefined): string | undefined {
  if (!detail?.status || detail.status === "unknown") return undefined;
  return detail.status;
}

// ── Per-kind builders ────────────────────────────────────────────────────────

function buildEpisodicCards(
  ctx: MediaPanelContext,
  detail: TitleDetail | undefined,
): MediaPanelMiniCard[] {
  const cards: MediaPanelMiniCard[] = [];
  const runtime = formatRuntimeMinutes(detail?.runtimeMinutes);

  // Resume is intentionally NOT a rail card: on post-play the left hero already
  // owns "resume" (it is what Enter does), so duplicating it here only clutters
  // the rail and risks contradicting the hero. The rail stays focused on the
  // episode chain — prev + up next.

  // Previous (post-play only): the episode before the current one. Resolve the
  // season from the label itself (cross-season aware) before falling back to the
  // current season, so a previous-season finale still maps to the right still.
  if (ctx.surface === "post-play" && ctx.previousEpisodeLabel) {
    const prevRef = parseEpisodeRef(ctx.previousEpisodeLabel);
    cards.push({
      kind: "prev",
      section: "prev",
      label: formatEpisodeCardLabel(ctx.previousEpisodeLabel) ?? ctx.previousEpisodeLabel,
      thumbUrl:
        ctx.previousEpisodeThumbUrl ??
        resolveEpisodeThumbUrl({
          titleDetail: detail,
          season: prevRef.season ?? ctx.currentSeason,
          episode: prevRef.episode,
          fallbackPosterUrl: ctx.posterUrl,
        }),
    });
  }

  // Up next: episode-chain next wins (binge the series); else the queue head.
  if (ctx.nextEpisodeLabel) {
    const nextRef = parseEpisodeRef(ctx.nextEpisodeLabel);
    cards.push({
      kind: "next",
      section: "up next",
      label: formatEpisodeCardLabel(ctx.nextEpisodeLabel) ?? ctx.nextEpisodeLabel,
      meta: autoplayMeta(ctx.autoplayPaused, runtime),
      thumbUrl:
        ctx.nextEpisodeThumbUrl ??
        resolveEpisodeThumbUrl({
          titleDetail: detail,
          season: nextRef.season ?? ctx.currentSeason,
          episode: nextRef.episode,
          fallbackPosterUrl: ctx.posterUrl,
        }),
    });
  } else if (ctx.queueNextLabel) {
    cards.push({
      kind: "next",
      section: "up next",
      label: ctx.queueNextLabel,
      meta: `from your queue · ${ctx.autoplayPaused ? "autoplay paused" : "autoplay"}`,
      thumbUrl: resolveSeasonAwarePosterUrl({
        titleDetail: detail,
        fallbackPosterUrl: ctx.posterUrl,
      }),
    });
  }

  return cards;
}

function buildSeriesPanel(ctx: MediaPanelContext, isAnime: boolean): MediaPanelModel {
  const detail = ctx.titleDetail;
  const seLine = buildSeasonEpisodeLine(ctx);
  const status = statusLabel(detail);
  const secondary = [seLine, status].filter(Boolean).join(" · ") || undefined;

  const facts: MediaPanelFact[] = [];
  if (detail?.year) facts.push({ label: "year", value: detail.year });
  if (detail?.genres?.[0]) facts.push({ label: "genre", value: detail.genres[0] });
  const score = formatScore(detail?.score);
  if (score) facts.push({ label: "score", value: score });
  if (detail?.episodeCount) facts.push({ label: "episodes", value: String(detail.episodeCount) });
  if (detail?.studios?.[0]) facts.push({ label: "studio", value: detail.studios[0] });

  return {
    kind: isAnime ? "anime" : "series",
    kindBadge: isAnime ? "anime" : "series",
    posterUrl: resolveSeasonAwarePosterUrl({
      titleDetail: detail,
      season: ctx.currentSeason,
      fallbackPosterUrl: ctx.posterUrl,
    }),
    title: ctx.title,
    secondary,
    facts,
    synopsis: detail?.synopsis,
    miniCards: buildEpisodicCards(ctx, detail),
    progress: buildProgress(ctx),
  };
}

function buildMoviePanel(ctx: MediaPanelContext): MediaPanelModel {
  const detail = ctx.titleDetail;
  const runtime = formatRuntimeMinutes(detail?.runtimeMinutes);
  const secondary = [detail?.year, runtime].filter(Boolean).join(" · ") || undefined;

  const facts: MediaPanelFact[] = [];
  if (detail?.year) facts.push({ label: "year", value: detail.year });
  if (runtime) facts.push({ label: "runtime", value: runtime });
  const score = formatScore(detail?.score);
  if (score) facts.push({ label: "score", value: score });
  if (detail?.contentRating) facts.push({ label: "rating", value: detail.contentRating });
  if (detail?.genres?.[0]) facts.push({ label: "genre", value: detail.genres[0] });

  // Movies have no episode chain, but a queued title can still be Up Next.
  const miniCards: MediaPanelMiniCard[] = [];
  if (ctx.queueNextLabel) {
    miniCards.push({
      kind: "next",
      section: "up next",
      label: ctx.queueNextLabel,
      meta: `from your queue · ${ctx.autoplayPaused ? "autoplay paused" : "autoplay"}`,
      thumbUrl: resolveSeasonAwarePosterUrl({
        titleDetail: detail,
        fallbackPosterUrl: ctx.posterUrl,
      }),
    });
  }

  return {
    kind: "movie",
    kindBadge: "movie",
    posterUrl: resolveSeasonAwarePosterUrl({
      titleDetail: detail,
      fallbackPosterUrl: ctx.posterUrl,
    }),
    title: ctx.title,
    secondary,
    facts,
    synopsis: detail?.synopsis,
    miniCards,
  };
}

function buildVideoPanel(ctx: MediaPanelContext): MediaPanelModel {
  const meta = ctx.videoMeta ?? undefined;
  const views = formatViewCount(meta?.viewCount);
  const isChannel = meta?.contentShape === "channel";
  const isPlaylist = meta?.contentShape === "playlist";
  const secondary = meta?.channelTitle || undefined;

  const facts: MediaPanelFact[] = [];
  const posted = formatRelativeTime(meta?.publishedAt);
  const length = formatDurationClock(meta?.durationSeconds);
  if (views) facts.push({ label: "views", value: views });
  if (posted) facts.push({ label: "posted", value: posted });
  if (length) facts.push({ label: "length", value: length });
  if (meta?.liveStatus === "live") facts.push({ label: "live", value: "● live", tone: "success" });
  else if (meta?.premium) facts.push({ label: "premium", value: "members" });

  // Up next: playlist/channel head when shaped that way, else the related queue
  // head. YouTube thumbnails always exist so the slot is reliably full.
  const miniCards: MediaPanelMiniCard[] = [];
  if (ctx.previousEpisodeLabel) {
    miniCards.push({
      kind: "prev",
      section: "prev",
      label: ctx.previousEpisodeLabel,
      thumbUrl: ctx.previousEpisodeThumbUrl,
    });
  }
  const nextLabel = ctx.nextEpisodeLabel ?? ctx.queueNextLabel;
  if (nextLabel) {
    const shaped = isPlaylist || isChannel;
    miniCards.push({
      kind: "next",
      section: "up next",
      label: nextLabel,
      meta: shaped ? (isChannel ? "channel" : "playlist") : "related",
      thumbUrl: ctx.nextEpisodeThumbUrl,
    });
  }

  return {
    kind: "video",
    kindBadge: isChannel ? "channel" : isPlaylist ? "playlist" : "video",
    posterUrl: ctx.posterUrl,
    title: ctx.title,
    secondary,
    facts,
    synopsis: ctx.titleDetail?.synopsis,
    miniCards,
  };
}

// ── Shared helpers ───────────────────────────────────────────────────────────

function buildSeasonEpisodeLine(ctx: MediaPanelContext): string | undefined {
  const s = padSE(ctx.currentSeason);
  const e = padSE(ctx.currentEpisode);
  if (s && e) return `S${s}E${e}`;
  if (e) return `E${e}`;
  return undefined;
}

function buildProgress(ctx: MediaPanelContext): MediaPanelProgress | undefined {
  if (!ctx.progress || ctx.progress.total <= 0) return undefined;
  const { watched, total } = ctx.progress;
  const percent = Math.max(0, Math.min(100, Math.round((watched / total) * 100)));
  return { percent, label: `${watched} / ${total} · ${percent}%` };
}

/**
 * Pull season + episode numbers out of a provider/catalog episode label. Handles
 * "S01 E12 — Title" / "S01E12" / bare "E12"; a missing season stays undefined so
 * callers can fall back to the current season.
 */
export function parseEpisodeRef(label: string | undefined): {
  readonly season?: number;
  readonly episode?: number;
} {
  const trimmed = label?.trim();
  if (!trimmed) return {};
  const full = trimmed.match(/S(\d+)\s*E(\d+)/iu);
  if (full?.[1] && full[2]) return { season: Number(full[1]), episode: Number(full[2]) };
  const episodeOnly = trimmed.match(/E(\d+)/iu);
  if (episodeOnly?.[1]) return { episode: Number(episodeOnly[1]) };
  return {};
}

/** Pull the episode number out of a provider/catalog episode label. */
export function parseEpisodeNumber(label: string | undefined): number | undefined {
  return parseEpisodeRef(label).episode;
}

// ── Entry point ──────────────────────────────────────────────────────────────

export function buildMediaPanel(ctx: MediaPanelContext): MediaPanelModel {
  switch (ctx.contentKind) {
    case "video":
      return buildVideoPanel(ctx);
    case "movie":
      return buildMoviePanel(ctx);
    case "anime":
      return buildSeriesPanel(ctx, true);
    case "series":
    default:
      return buildSeriesPanel(ctx, false);
  }
}
