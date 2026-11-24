// =============================================================================
// Late subtitle resolver
//
// When the resolved stream lacks the preferred subtitle language, searches
// Wyzie (the user's own key) in the background and attaches what it finds to
// the running player. Work is scoped to one playback iteration: its abort
// signal cancels the lookup and the attach wait when the loop moves on.
// =============================================================================

import { updatePlaybackFeedback } from "@/app/playback/playback-phase-feedback";
import { playbackSubtitlePreference } from "@/app/playback/playback-profile-context";
import { shouldAttemptLateSubtitleLookup } from "@/app/playback/subtitle-selection";
import type { PhaseContext } from "@/app/session/Phase";
import { resolveProvenNumericTmdbId } from "@/domain/catalog/tmdb-identity";
import type { TitleInfo, EpisodeInfo, StreamInfo, SubtitleTrack } from "@/domain/types";
import { buildSubtitleDiagnosticEvent } from "@/services/diagnostics/diagnostic-event-helpers";
import {
  mergeSubtitleTracks,
  resolveSubtitlesByTmdbId,
  resolveWyzieApiKey,
  selectAutomaticSubtitle,
} from "@/subtitle";

/** Lookups already running this phase, keyed by title/episode/language. */
const lateSubtitleInflight = new Set<string>();
/** Session-scoped so the "set up subtitle search" note is shown once, not per episode. */
let wyzieKeyNoticeShown = false;

/** Called when a playback phase starts: no lookup from a previous phase is still ours. */
export function resetLateSubtitleLookups(): void {
  lateSubtitleInflight.clear();
}

export function startLateSubtitleResolver({
  stream,
  title,
  episode,
  context,
  playbackIterationSignal,
}: {
  stream: StreamInfo;
  title: TitleInfo;
  episode: EpisodeInfo;
  context: PhaseContext;
  playbackIterationSignal?: AbortSignal;
}): void {
  const iterationSignal = playbackIterationSignal ?? context.signal;
  const { stateManager, diagnosticsService, logger } = context.container;
  const mode = stateManager.getState().mode;
  const requestedSubLang = playbackSubtitlePreference({
    overrides: stateManager.getState().playbackTrackPreferences,
    mode,
    title,
    config: context.container.config,
  });
  const provenTmdbId = resolveProvenNumericTmdbId(title, mode);
  const lookupDecision = shouldAttemptLateSubtitleLookup({
    stream,
    requestedSubLang,
    hasTmdbId: provenTmdbId !== null,
    networkAvailable:
      title.launchSource !== "offline-library" && context.container.connectivity.isOnline(),
  });
  if (!lookupDecision.attempt) {
    if (
      lookupDecision.reason !== "disabled" &&
      lookupDecision.reason !== "offline" &&
      lookupDecision.reason !== "attached" &&
      lookupDecision.reason !== "hardsub-satisfied"
    ) {
      diagnosticsService.record(
        buildSubtitleDiagnosticEvent({
          operation: "subtitle.lookup.skipped",
          status: "skipped",
          severity: "degraded",
          recommendedAction: "none",
          message:
            lookupDecision.reason === "tmdb-id-missing"
              ? "Late subtitle lookup skipped (TMDB identity missing)"
              : "Late subtitle lookup skipped",
          titleId: title.id,
          season: episode.season,
          episode: episode.episode,
          context: {
            requestedSubLang,
            reason: lookupDecision.reason,
            availableTracks: lookupDecision.availableTracks,
            // Redact: never report bare anime/AniList catalog ids as TMDB ids.
            ...(lookupDecision.reason === "tmdb-id-missing"
              ? { tmdbId: "<missing>" }
              : { titleId: title.id }),
          },
        }),
      );
    }
    return;
  }

  const tmdbId = provenTmdbId;
  if (!tmdbId) return;

  // The external search is the user's own Wyzie key (Kunai ships none), so an
  // unconfigured key is an ordinary "not available here" — say so once in
  // diagnostics rather than spending a request that can only 401.
  const wyzieApiKey = resolveWyzieApiKey(context.container.config.getRaw().wyzieApiKey);
  if (!wyzieApiKey) {
    diagnosticsService.record(
      buildSubtitleDiagnosticEvent({
        operation: "subtitle.lookup.skipped",
        status: "skipped",
        severity: "healthy",
        recommendedAction: "none",
        message: "Late subtitle lookup skipped (no Wyzie API key configured)",
        titleId: title.id,
        season: episode.season,
        episode: episode.episode,
        context: { reason: "wyzie-key-missing", requestedSubLang },
      }),
    );
    // Told once per session, not per episode: a stream with no subtitles and
    // no explanation reads as Kunai losing them, when the search that would
    // find them simply is not set up yet.
    if (!wyzieKeyNoticeShown) {
      wyzieKeyNoticeShown = true;
      updatePlaybackFeedback(context, {
        note: "Preferred subtitles unavailable. Add a Wyzie key in Settings › General to search for them.",
      });
    }
    return;
  }

  const inflightKey = `${title.id}:${episode.season}:${episode.episode}:${requestedSubLang}`;
  if (lateSubtitleInflight.has(inflightKey)) {
    diagnosticsService.record(
      buildSubtitleDiagnosticEvent({
        operation: "subtitle.lookup.skipped",
        status: "skipped",
        severity: "healthy",
        recommendedAction: "wait",
        message: "Late subtitle lookup skipped (already in flight)",
        titleId: title.id,
        season: episode.season,
        episode: episode.episode,
        context: { reason: "already-in-flight" },
      }),
    );
    return;
  }
  lateSubtitleInflight.add(inflightKey);

  diagnosticsService.record(
    buildSubtitleDiagnosticEvent({
      operation: "subtitle.lookup.started",
      status: "started",
      severity: "healthy",
      recommendedAction: "wait",
      message: "Late subtitle lookup started",
      titleId: title.id,
      season: episode.season,
      episode: episode.episode,
      context: {
        titleId: title.id,
        type: title.type,
        season: episode.season,
        episode: episode.episode,
        requestedSubLang,
      },
    }),
  );

  void (async () => {
    try {
      const result = await resolveSubtitlesByTmdbId({
        tmdbId,
        type: title.type,
        season: title.type === "series" ? episode.season : undefined,
        episode: title.type === "series" ? episode.episode : undefined,
        preferredLang: requestedSubLang,
        apiKey: wyzieApiKey,
        signal: iterationSignal,
      });

      if (iterationSignal.aborted || result.outcome === "cancelled") return;
      if (result.list.length === 0) {
        diagnosticsService.record(
          buildSubtitleDiagnosticEvent({
            operation: result.failed ? "subtitle.lookup.failed" : "subtitle.lookup.empty",
            status: result.failed ? "failed" : "skipped",
            severity: result.failed ? "recoverable" : "degraded",
            failureClass: result.failed ? "unknown" : undefined,
            recommendedAction: result.failed ? undefined : "none",
            message: result.failed ? "Late subtitle lookup failed" : "Late subtitle lookup empty",
            titleId: title.id,
            season: episode.season,
            episode: episode.episode,
            context: {
              titleId: title.id,
              requestedSubLang,
              failed: result.failed,
              outcome: result.outcome,
            },
          }),
        );
        return;
      }

      const mergedSubtitleList = mergeSubtitleTracks(stream.subtitleList, result.list);
      const selected = selectAutomaticSubtitle(mergedSubtitleList, requestedSubLang);
      const selectedUrl = selected?.url ?? result.selected ?? null;
      if (!selectedUrl) {
        diagnosticsService.record(
          buildSubtitleDiagnosticEvent({
            operation: "subtitle.lookup.no-selectable-url",
            status: "failed",
            severity: "recoverable",
            failureClass: "parse",
            message: "Late subtitle lookup found tracks but no selectable URL",
            titleId: title.id,
            season: episode.season,
            episode: episode.episode,
            context: { titleId: title.id, trackCount: mergedSubtitleList.length },
          }),
        );
        return;
      }

      const attached = await attachLateSubtitlesWhenPlayerReady(context, {
        primarySubtitle: selectedUrl,
        subtitleTracks: mergedSubtitleList,
        playbackIterationSignal,
      });
      if (!attached) return;

      const currentState = stateManager.getState();
      const currentStream = currentState.stream;
      if (
        !iterationSignal.aborted &&
        currentState.currentTitle?.id === title.id &&
        currentState.currentEpisode?.season === episode.season &&
        currentState.currentEpisode?.episode === episode.episode &&
        currentStream?.url === stream.url &&
        currentStream.timestamp === stream.timestamp &&
        currentStream.providerResolveResult === stream.providerResolveResult
      ) {
        // The attach is silent otherwise: subtitles appear mid-playback with no
        // account of where they came from or how many alternates were found.
        updatePlaybackFeedback(context, {
          note:
            mergedSubtitleList.length > 1
              ? `Attached subtitles · ${mergedSubtitleList.length} tracks available in the player`
              : "Attached subtitles found by search",
        });

        stateManager.dispatch({
          type: "SET_STREAM",
          stream: {
            ...currentStream,
            subtitle:
              currentState.playbackTrackPreferences.subtitle === "none"
                ? undefined
                : (currentStream.subtitle ?? selectedUrl),
            subtitleList: mergeSubtitleTracks(currentStream.subtitleList, result.list),
            subtitleSource: "wyzie",
            subtitleEvidence: {
              directSubtitleObserved: Boolean(stream.subtitleList?.length),
              wyzieSearchObserved: true,
              reason: "wyzie-selected",
            },
          },
        });
      }

      diagnosticsService.record(
        buildSubtitleDiagnosticEvent({
          operation: "subtitle.attach.outcome",
          status: "succeeded",
          severity: "healthy",
          recommendedAction: "none",
          message: "Late subtitle lookup attached tracks",
          titleId: title.id,
          context: {
            titleId: title.id,
            outcome: "attached",
            delivery: "late",
            trackCount: mergedSubtitleList.length,
          },
        }),
      );
    } catch (error) {
      if (iterationSignal.aborted) return;
      logger.warn("Late subtitle lookup failed", { error: String(error) });
      diagnosticsService.record(
        buildSubtitleDiagnosticEvent({
          operation: "subtitle.lookup.failed",
          status: "failed",
          severity: "recoverable",
          failureClass: "unknown",
          message: "Late subtitle lookup failed",
          titleId: title.id,
          context: { titleId: title.id, error: String(error) },
        }),
      );
    } finally {
      lateSubtitleInflight.delete(inflightKey);
    }
  })();
}

async function attachLateSubtitlesWhenPlayerReady(
  context: PhaseContext,
  attachment: {
    primarySubtitle: string;
    subtitleTracks: readonly SubtitleTrack[];
    playbackIterationSignal?: AbortSignal;
  },
): Promise<boolean> {
  const player = context.container.playerControl;
  const iterationSignal = attachment.playbackIterationSignal ?? context.signal;
  const deadline = Date.now() + 30_000;

  while (!iterationSignal.aborted && Date.now() < deadline) {
    let active = player.getActive();
    if (!active) {
      active = await player.waitForActivePlayer({
        signal: iterationSignal,
        timeoutMs: Math.max(0, deadline - Date.now()),
      });
      if (!active) return false;
    }

    const attached = await player.attachLateSubtitles(attachment, "late-subtitle-resolver");
    if (attached) return true;

    await Bun.sleep(250);
  }
  context.container.diagnosticsService.record(
    buildSubtitleDiagnosticEvent({
      operation: "subtitle.attach.outcome",
      status: "timed-out",
      severity: "recoverable",
      failureClass: "timeout",
      message: "Late subtitle attachment timed out waiting for player",
      context: {
        outcome: "player-ready-timeout",
        delivery: "late",
        trackCount: attachment.subtitleTracks.length,
      },
    }),
  );
  return false;
}
