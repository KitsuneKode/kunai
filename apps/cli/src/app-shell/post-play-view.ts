// =============================================================================
// post-play-view.ts — pure view-model builder for PostPlayShell
//
// Maps PostPlayShellProps (state + catalog facts) → a structured PostPlayView
// that the component renders without any conditional derivation inline.
//
// Design authority: .design/cli/kunai-sakura-canonical.html §3 Post-play
// Rules:
//   • plum (milestone) only on series-complete
//   • caught-up stays mint (ok) + calendar framing — never confused with done
//   • titles win by weight/brightness, metadata muted
//   • one primary ActionRow per state (the dominant verb)
//   • recommendation cards show title (bold) + dim reason/year snippet
//   • rail facts: up-next card, season progress, catalog metadata
// =============================================================================

import { resolveCatalogPosterUrl } from "@/domain/catalog/resolve-catalog-poster-url";
import type { TitleDetail } from "@/domain/catalog/title-detail";
import type { PostPlayState } from "@/domain/playback/post-play-state";

import { resolveKeybinding, resolvePostPlaybackBindingResult } from "./keybinding-runtime";
import { RETURN_LOOP_POST_PLAY_CAUGHT_UP_CALENDAR } from "./return-loop-copy";
import type { PlaybackRecommendationRailItem } from "./types";

// ── Hero kind ─────────────────────────────────────────────────────────────────

export type PostPlayHeroKind =
  | "did-not-start"
  | "stopped-early"
  | "mid-series"
  | "caught-up"
  | "season-finale"
  | "movie-complete"
  | "series-complete";

// ── Action rows ───────────────────────────────────────────────────────────────

export type PostPlayActionRow = {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  readonly shortcut: string;
  readonly primary: boolean;
};

// ── Discovery card ────────────────────────────────────────────────────────────

export type PostPlayDiscoveryCard = {
  readonly id: string;
  readonly index: number; // 1-based for display
  readonly title: string;
  readonly reason: string; // dim snippet: overview excerpt or year
  readonly posterUrl?: string;
};

// ── Rail fact ─────────────────────────────────────────────────────────────────

export type PostPlayRailFact = {
  readonly label: string;
  readonly value: string;
  readonly tone?: "success" | "muted";
};

// ── Up-next card (rail) ───────────────────────────────────────────────────────

export type PostPlayUpNextCard = {
  readonly label: string;
  readonly meta: string;
};

// ── Series-complete celebration ───────────────────────────────────────────────

export type PostPlayCelebration = {
  readonly statLine: string; // "28 episodes · 2 seasons · 2023"
  readonly watchTimeLine?: string;
};

// ── Next-Up hero (body centerpiece) ───────────────────────────────────────────

export type PostPlayNextUpHero = {
  /** "next-episode" = binge the current series; "queue" = cross-title queue head. */
  readonly kind: "next-episode" | "queue" | "resume" | "next-season";
  readonly label: string;
  readonly meta: string;
};

// ── Progress bar (season / series) ───────────────────────────────────────────

export type PostPlayProgressBar = {
  readonly watched: number;
  readonly total: number;
  readonly percent: number;
  /** "7 / 12 · 58%" or "28 / 28 this season" etc. */
  readonly label: string;
};

// ── Full view ─────────────────────────────────────────────────────────────────

export type PostPlayView = {
  readonly heroKind: PostPlayHeroKind;
  /** Colored ZONE label ("⏸ stopped early", "◉ caught up", "✦ SERIES COMPLETE", …). */
  readonly heroLabel: string;
  /** Color token name: "accent" | "ok" | "milestone" | "dim". */
  readonly heroColor: "accent" | "ok" | "milestone" | "dim";
  /** Subtitle below the hero ("next broadcast · Thu 23:00 · in 3d", etc.) */
  readonly heroSub?: string;
  readonly progressBar?: PostPlayProgressBar;
  readonly actions: readonly PostPlayActionRow[];
  readonly discoveryHeading: string;
  readonly discovery: readonly PostPlayDiscoveryCard[];
  readonly upNext?: PostPlayUpNextCard;
  readonly nextUpHero?: PostPlayNextUpHero;
  readonly celebration?: PostPlayCelebration;
  readonly railFacts: readonly PostPlayRailFact[];
  /** Catalog-sourced metadata line for the episode page ("S04E07 · U/A 16+ · sub | dub"). */
  readonly episodeMeta?: string;
  /** One-line completion line ("✓ episode complete · watched 24m"). */
  readonly completionLine?: string;
};

// ── Input ─────────────────────────────────────────────────────────────────────

export type BuildPostPlayViewProps = {
  readonly title: string;
  readonly episodeLabel: string;
  readonly nextEpisodeLabel?: string;
  /**
   * Head of the cross-title queue, if any. Surfaced as Up Next only when there is
   * no episode-chain next (series finished / movie), mirroring resolveNextUp's
   * Netflix-like policy: binge the current series first, else play the queue.
   */
  readonly queueNextLabel?: string;
  readonly resumeLabel?: string;
  readonly postPlayState: PostPlayState;
  readonly recommendations?: readonly PlaybackRecommendationRailItem[];
  readonly totalEpisodes?: number;
  readonly watchedEpisodes?: number;
  readonly currentSeason?: number;
  readonly titleDetail?: TitleDetail;
  readonly autoplayPaused?: boolean;
  readonly autoskipPaused?: boolean;
  readonly stopAfterCurrent?: boolean;
  /** Pre-formatted personal watch-time line; omitted when disabled or below threshold. */
  readonly watchTimeSummary?: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildProgressBar(watched: number, total: number, suffix = ""): PostPlayProgressBar {
  const percent = Math.round((watched / total) * 100);
  const label = `${watched} / ${total}${suffix ? ` ${suffix}` : ""} · ${percent}%`;
  return { watched, total, percent, label };
}

// "S01 E06 — Challengers of Science" → "E06 · Challengers of Science".
// A placeholder name that just repeats the episode number collapses to the tag.
function formatUpNextLabel(nextEpisodeLabel: string): string {
  const match = nextEpisodeLabel.match(/^S\d+\s+(E\d+)\s+—\s+(.+)$/u);
  if (!match) return nextEpisodeLabel;
  const tag = match[1] ?? "";
  const name = match[2]?.trim() ?? "";
  if (!name || /^episode\s+\d+$/iu.test(name)) return tag || nextEpisodeLabel;
  return `${tag} · ${name}`;
}

// Up-next meta: "Status available · autoplay on · 24m" — runtime only when known.
function buildUpNextMeta(titleDetail: TitleDetail | undefined, autoplayPaused = false): string {
  const parts = ["Status available", autoplayPaused ? "autoplay paused" : "autoplay on"];
  if (titleDetail?.runtimeMinutes) parts.push(`${titleDetail.runtimeMinutes}m`);
  return parts.join(" · ");
}

function buildUpNextCard(
  nextEpisodeLabel: string | undefined,
  titleDetail: TitleDetail | undefined,
  autoplayPaused: boolean | undefined,
  queueNextLabel?: string,
): PostPlayUpNextCard | undefined {
  // Episode-chain next wins (binge the current series); otherwise fall back to the
  // cross-title queue head. Mirrors resolveNextUp's policy at the view layer.
  if (nextEpisodeLabel) {
    return {
      label: formatUpNextLabel(nextEpisodeLabel),
      meta: buildUpNextMeta(titleDetail, autoplayPaused),
    };
  }
  if (queueNextLabel) {
    return {
      label: queueNextLabel,
      meta: `From your queue · ${autoplayPaused ? "autoplay paused" : "autoplay on"}`,
    };
  }
  return undefined;
}

// Body-centerpiece hero. Mirrors buildUpNextCard's policy (binge the current
// series first, else the cross-title queue head) but with state-specific framing.
function buildNextUpHero(
  props: BuildPostPlayViewProps,
  variant: "next-episode" | "resume" | "next-season" | "queue-only",
): PostPlayNextUpHero | undefined {
  const { nextEpisodeLabel, queueNextLabel, titleDetail, autoplayPaused, resumeLabel } = props;
  if (variant === "resume" && resumeLabel) {
    return { kind: "resume", label: resumeLabel, meta: "same stream · same position" };
  }
  if (variant !== "queue-only" && nextEpisodeLabel) {
    return {
      kind: variant === "next-season" ? "next-season" : "next-episode",
      label: formatUpNextLabel(nextEpisodeLabel),
      meta: buildUpNextMeta(titleDetail, autoplayPaused),
    };
  }
  if (queueNextLabel) {
    return {
      kind: "queue",
      label: queueNextLabel,
      meta: `From your queue · ${autoplayPaused ? "autoplay paused" : "autoplay on"}`,
    };
  }
  return undefined;
}

function buildDiscovery(
  recs: readonly PlaybackRecommendationRailItem[],
): readonly PostPlayDiscoveryCard[] {
  return recs.slice(0, 3).map((rec, i) => {
    // Prefer a dim overview snippet (first sentence / up to ~40 chars), else year
    const reason = rec.overview
      ? (rec.overview.split(/[.!?]/u)[0]?.trim().slice(0, 44) ?? rec.year ?? "")
      : (rec.year ?? "");
    const posterUrl = resolveCatalogPosterUrl(rec.posterPath, { tmdbSize: "w185" }) ?? undefined;
    return { id: rec.id, index: i + 1, title: rec.title, reason, posterUrl };
  });
}

// ── Main builder ──────────────────────────────────────────────────────────────

export function buildPostPlayView(props: BuildPostPlayViewProps): PostPlayView {
  const {
    title,
    episodeLabel,
    nextEpisodeLabel,
    queueNextLabel,
    resumeLabel,
    postPlayState,
    recommendations = [],
    totalEpisodes,
    watchedEpisodes,
    currentSeason,
    titleDetail,
    autoplayPaused,
    autoskipPaused,
    stopAfterCurrent,
  } = props;

  const isMovie = episodeLabel === "Movie";
  const discovery = buildDiscovery(recommendations);

  // Season progress bar — show when we have both watched + total episode counts
  const progressBar =
    totalEpisodes && watchedEpisodes !== undefined && totalEpisodes > 0
      ? buildProgressBar(watchedEpisodes, totalEpisodes, "")
      : undefined;

  // Episode meta line from catalog (ratings, audio, etc.)
  const episodeMeta = buildEpisodeMeta(episodeLabel, titleDetail);

  // ── did-not-start ────────────────────────────────────────────────────────
  if (postPlayState.kind === "did-not-start") {
    return {
      heroKind: "did-not-start",
      heroLabel: "▢ playback didn't start",
      heroColor: "dim",
      heroSub: "nothing was recorded for this title",
      actions: [
        {
          id: "try-again",
          label: "Try again",
          detail: "retry the same episode",
          shortcut: "r",
          primary: true,
        },
        {
          id: "fallback",
          label: "Fallback",
          detail: "try another provider",
          shortcut: "f",
          primary: false,
        },
        {
          id: "source",
          label: "Sources",
          detail: "choose another stream",
          shortcut: "o",
          primary: false,
        },
        {
          id: "search",
          label: "Search",
          detail: "find another title",
          shortcut: "s",
          primary: false,
        },
      ],
      discoveryHeading: "you might also like",
      discovery,
      railFacts: buildBasicRailFacts(title, titleDetail, currentSeason),
      episodeMeta,
    };
  }

  // ── stopped early ────────────────────────────────────────────────────────
  if (resumeLabel) {
    return {
      heroKind: "stopped-early",
      nextUpHero: buildNextUpHero(props, "resume"),
      heroLabel: "⏸ stopped early",
      heroColor: "accent",
      progressBar,
      actions: [
        {
          id: "resume",
          label: "↵ Resume",
          detail: "same stream · same position",
          shortcut: "↵",
          primary: true,
        },
        {
          id: "episodes",
          label: "Episodes",
          detail: "open season list",
          shortcut: "e",
          primary: false,
        },
        {
          id: "replay",
          label: "Replay",
          detail: "rewatch from the start",
          shortcut: "r",
          primary: false,
        },
      ],
      discoveryHeading: "you might also like",
      discovery,
      upNext: buildUpNextCard(nextEpisodeLabel, titleDetail, autoplayPaused, queueNextLabel),
      railFacts: buildSeriesRailFacts(props, progressBar),
      episodeMeta,
    };
  }

  // ── movie complete ───────────────────────────────────────────────────────
  // (did-not-start is handled by an earlier return, so kind is already narrowed.)
  if (isMovie) {
    return {
      heroKind: "movie-complete",
      nextUpHero: buildNextUpHero(props, "queue-only"),
      heroLabel: "✓ movie complete",
      heroColor: "ok",
      completionLine: `✓ ${title}`,
      actions: [
        {
          id: "replay",
          label: "Replay",
          detail: "rewatch from the start",
          shortcut: "r",
          primary: true,
        },
        {
          id: "search",
          label: "Search",
          detail: "find another title",
          shortcut: "/",
          primary: false,
        },
      ],
      discoveryHeading: "because you watched this",
      discovery,
      // Movies have no episode chain, but a queued title can still be Up Next.
      upNext: buildUpNextCard(undefined, titleDetail, autoplayPaused, queueNextLabel),
      railFacts: buildMovieRailFacts(titleDetail),
      episodeMeta,
    };
  }

  // ── mid-series ───────────────────────────────────────────────────────────
  if (postPlayState.kind === "mid-series") {
    const nextLabel = nextEpisodeLabel ? formatUpNextLabel(nextEpisodeLabel) : "Next episode";
    const autoplayDetail = autoplayPaused ? "autoplay paused" : "autoplay on";
    const autoskipDetail = autoskipPaused ? "autoskip paused" : "autoskip on";
    const chainDetail = stopAfterCurrent ? "chain stops after next play" : "chain continues";
    return {
      heroKind: "mid-series",
      nextUpHero: buildNextUpHero(props, "next-episode"),
      heroLabel: "✓ episode complete",
      heroColor: "ok",
      completionLine: "✓ episode complete",
      actions: [
        {
          id: "next",
          label: "Next episode",
          detail: `${nextLabel} · ${autoplayDetail}`,
          shortcut: "↵ n",
          primary: true,
        },
        {
          id: "episodes",
          label: "Episodes",
          detail: "open season list, current stays marked",
          shortcut: "e",
          primary: false,
        },
        {
          id: "session-controls",
          label: "Session",
          detail: `${autoskipDetail} · ${chainDetail}`,
          shortcut: "a · u · x",
          primary: false,
        },
        {
          id: "replay",
          label: "Replay / Tracks",
          detail: "rewatch, or change source · quality · audio",
          shortcut: "r · t",
          primary: false,
        },
      ],
      discoveryHeading: "because you watched this",
      discovery,
      upNext: buildUpNextCard(nextEpisodeLabel, titleDetail, autoplayPaused, queueNextLabel),
      railFacts: buildSeriesRailFacts(props, progressBar),
      episodeMeta,
    };
  }

  // ── caught-up ────────────────────────────────────────────────────────────
  if (postPlayState.kind === "caught-up") {
    const airLine = postPlayState.nextAirDate
      ? `next broadcast · ${postPlayState.nextAirDate}`
      : undefined;
    return {
      heroKind: "caught-up",
      nextUpHero: buildNextUpHero(props, "queue-only"),
      heroLabel: "◉ caught up · airing",
      heroColor: "ok",
      heroSub: airLine,
      actions: [
        {
          id: "bookmark",
          label: "Bookmark",
          detail: "save to watchlist for release alerts",
          shortcut: "w",
          primary: true,
        },
        {
          id: "calendar",
          label: "Calendar",
          detail: RETURN_LOOP_POST_PLAY_CAUGHT_UP_CALENDAR,
          shortcut: "/calendar",
          primary: false,
        },
        {
          id: "search",
          label: "Search",
          detail: "find something to watch now",
          shortcut: "s",
          primary: false,
        },
      ],
      discoveryHeading: "you might also like",
      discovery,
      // Caught up on this series, but a queued title can still be Up Next now.
      upNext: buildUpNextCard(undefined, titleDetail, autoplayPaused, queueNextLabel),
      railFacts: buildSeriesRailFacts(props, progressBar),
      episodeMeta,
    };
  }

  // ── season-finale ────────────────────────────────────────────────────────
  if (postPlayState.kind === "season-finale") {
    const seasonLabel = currentSeason ? `Season ${currentSeason}` : "Season";
    const continueDetail = postPlayState.hasNextSeason
      ? "continue to next season"
      : "no more seasons available";

    const seasonProgress =
      totalEpisodes && watchedEpisodes !== undefined && totalEpisodes > 0
        ? buildProgressBar(watchedEpisodes, totalEpisodes, "this season")
        : undefined;

    return {
      heroKind: "season-finale",
      nextUpHero: buildNextUpHero(
        props,
        postPlayState.hasNextSeason ? "next-season" : "queue-only",
      ),
      heroLabel: `✦ ${seasonLabel} complete`,
      heroColor: "ok",
      progressBar: seasonProgress,
      actions: postPlayState.hasNextSeason
        ? [
            {
              id: "next-season",
              label: "↵ Continue",
              detail: continueDetail,
              shortcut: "↵",
              primary: true,
            },
            {
              id: "episodes",
              label: "Episodes",
              detail: "review this season",
              shortcut: "e",
              primary: false,
            },
          ]
        : [
            {
              id: "search",
              label: "Search",
              detail: "find another title",
              shortcut: "s",
              primary: false,
            },
            {
              id: "episodes",
              label: "Episodes",
              detail: "review this season",
              shortcut: "e",
              primary: false,
            },
          ],
      discoveryHeading: "you might also like",
      discovery,
      railFacts: buildSeriesRailFacts(props, progressBar),
      episodeMeta,
    };
  }

  // ── series-complete ──────────────────────────────────────────────────────
  // postPlayState.kind === "series-complete"
  const seasons = titleDetail?.seasonCount ?? currentSeason;
  const episodes = titleDetail?.episodeCount ?? totalEpisodes;
  const seriesMeta = [
    episodes ? `${episodes} episodes` : undefined,
    seasons ? `${seasons} season${seasons === 1 ? "" : "s"}` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");

  const celebration: PostPlayCelebration = {
    statLine: seriesMeta || "Series complete",
    watchTimeLine: props.watchTimeSummary,
  };

  return {
    heroKind: "series-complete",
    nextUpHero: buildNextUpHero(props, "queue-only"),
    heroLabel: "✦ SERIES COMPLETE",
    heroColor: "milestone",
    heroSub: seriesMeta || undefined,
    celebration,
    actions: [
      {
        id: "search",
        label: "Search",
        detail: "find something new to watch",
        shortcut: "s",
        primary: false,
      },
      {
        id: "replay",
        label: "Replay",
        detail: "rewatch from the beginning",
        shortcut: "r",
        primary: false,
      },
    ],
    discoveryHeading: "because you finished this",
    discovery,
    // No episode chain remains, but a queued title can still be Up Next.
    upNext: buildUpNextCard(undefined, titleDetail, autoplayPaused, queueNextLabel),
    railFacts: buildSeriesCompleteRailFacts(title, titleDetail, currentSeason, totalEpisodes),
    episodeMeta,
  };
}

// ── Rail fact builders ────────────────────────────────────────────────────────

function buildEpisodeMeta(
  episodeLabel: string,
  detail: TitleDetail | undefined,
): string | undefined {
  const parts: string[] = [episodeLabel];
  if (detail?.contentRating) parts.push(detail.contentRating);
  if (detail?.releaseDate) parts.push(`aired ${detail.releaseDate}`);
  return parts.length > 1 ? parts.join(" · ") : undefined;
}

function buildBasicRailFacts(
  title: string,
  detail: TitleDetail | undefined,
  currentSeason: number | undefined,
): readonly PostPlayRailFact[] {
  const facts: PostPlayRailFact[] = [];
  if (detail?.year) facts.push({ label: "year", value: detail.year });
  if (detail?.genres?.[0]) facts.push({ label: "genre", value: detail.genres[0] });
  if (currentSeason) facts.push({ label: "season", value: String(currentSeason) });
  if (detail?.status) facts.push({ label: "status", value: detail.status });
  return facts;
}

function buildSeriesRailFacts(
  props: BuildPostPlayViewProps,
  progressBar: PostPlayProgressBar | undefined,
): readonly PostPlayRailFact[] {
  const { titleDetail, totalEpisodes, watchedEpisodes } = props;
  const facts: PostPlayRailFact[] = [];

  if (progressBar) {
    facts.push({
      label: "progress",
      value: `${watchedEpisodes} / ${totalEpisodes} · ${progressBar.percent}%`,
    });
  }
  if (titleDetail?.year) facts.push({ label: "year", value: titleDetail.year });
  if (titleDetail?.genres?.[0]) facts.push({ label: "genre", value: titleDetail.genres[0] });
  if (titleDetail?.status === "airing")
    facts.push({ label: "status", value: "airing", tone: "success" });
  else if (titleDetail?.status) facts.push({ label: "status", value: titleDetail.status });

  return facts;
}

function buildMovieRailFacts(detail: TitleDetail | undefined): readonly PostPlayRailFact[] {
  const facts: PostPlayRailFact[] = [];
  if (detail?.year) facts.push({ label: "year", value: detail.year });
  if (detail?.runtimeMinutes) facts.push({ label: "runtime", value: `${detail.runtimeMinutes}m` });
  if (detail?.genres?.[0]) facts.push({ label: "genre", value: detail.genres[0] });
  if (detail?.contentRating) facts.push({ label: "rating", value: detail.contentRating });
  return facts;
}

function buildSeriesCompleteRailFacts(
  title: string,
  detail: TitleDetail | undefined,
  currentSeason: number | undefined,
  totalEpisodes: number | undefined,
): readonly PostPlayRailFact[] {
  const facts: PostPlayRailFact[] = [];
  const ep = detail?.episodeCount ?? totalEpisodes;
  const s = detail?.seasonCount ?? currentSeason;
  if (ep) facts.push({ label: "episodes", value: String(ep) });
  if (s) facts.push({ label: "seasons", value: String(s) });
  if (detail?.year) facts.push({ label: "year", value: detail.year });
  if (detail?.genres?.[0]) facts.push({ label: "genre", value: detail.genres[0] });
  return facts;
}

/** Post-play choices that should return to the playback bootstrap surface immediately. */
export function isPostPlayPlaybackRestartResult(
  result: import("./types").PlaybackShellResult,
): boolean {
  if (typeof result !== "string") return false;
  return (
    result === "resume" ||
    result === "replay" ||
    result === "next" ||
    result === "previous" ||
    result === "next-season" ||
    result === "recover" ||
    result === "recompute" ||
    result === "fallback"
  );
}

export function isPostPlayConfirmInput(input: string, key: { readonly return?: boolean }): boolean {
  return Boolean(key.return) || input === "\r" || input === "\n";
}

export type PostPlayUnhandledInputContext = {
  readonly blockedByOverlay?: boolean;
  readonly postPlayStateKind: PostPlayState["kind"];
  readonly selectedActionAvailable: boolean;
  readonly recommendationCount: number;
};

export type PostPlayUnhandledInputResult =
  | { readonly type: "run-selected-action" }
  | { readonly type: "recommendation"; readonly index: number }
  | { readonly type: "recommendation-actions"; readonly index: number }
  | { readonly type: "shell-result"; readonly result: import("./types").PlaybackShellResult };

export function resolvePostPlayUnhandledInput(
  input: string,
  key: { readonly return?: boolean; readonly ctrl?: boolean; readonly meta?: boolean },
  context: PostPlayUnhandledInputContext,
): PostPlayUnhandledInputResult | null {
  if (context.blockedByOverlay) return null;
  if (isPostPlayConfirmInput(input, key)) {
    if (context.postPlayStateKind === "series-complete" && !context.selectedActionAvailable) {
      return context.recommendationCount > 0 ? { type: "recommendation", index: 0 } : null;
    }
    return context.selectedActionAvailable ? { type: "run-selected-action" } : null;
  }
  const binding = resolveKeybinding(["postPlayback"], input, key);
  const bindingResult = binding ? resolvePostPlaybackBindingResult(binding) : null;
  if (binding && bindingResult) {
    if (binding.id === "post-watchlist" && context.postPlayStateKind !== "caught-up") return null;
    if (
      (binding.id === "post-replay" ||
        binding.id === "post-fallback" ||
        binding.id === "post-source" ||
        binding.id === "post-diagnostics" ||
        binding.id === "post-search") &&
      context.postPlayStateKind !== "did-not-start"
    ) {
      return null;
    }
    return { type: "shell-result", result: bindingResult };
  }
  if (context.postPlayStateKind === "did-not-start") {
    return null;
  }
  if (input === "1" || input === "2" || input === "3") {
    const index = Number(input) - 1;
    return index < context.recommendationCount ? { type: "recommendation", index } : null;
  }
  const actionIndex = input === "!" ? 0 : input === "@" ? 1 : input === "#" ? 2 : -1;
  if (actionIndex >= 0 && actionIndex < context.recommendationCount) {
    return { type: "recommendation-actions", index: actionIndex };
  }
  return null;
}

/** Maps a highlighted post-play action row to the shell result PlaybackPhase expects. */
export function resolvePostPlayMenuAction(
  action: PostPlayActionRow,
): import("./types").PlaybackShellResult | null {
  switch (action.id) {
    case "try-again":
    case "replay":
      return "replay";
    case "fallback":
      return "fallback";
    case "source":
      return "source";
    case "search":
      return "search";
    case "resume":
      return "resume";
    case "next":
      return "next";
    case "episodes":
      return "pick-episode";
    case "next-season":
      return "next-season";
    case "bookmark":
      return "bookmark";
    case "calendar":
      return "calendar";
    case "session-controls":
      return null;
    default:
      return null;
  }
}
