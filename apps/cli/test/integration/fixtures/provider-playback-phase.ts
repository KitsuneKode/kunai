// Child-process fixture for the PlaybackPhase characterization net.
//
// Drives the real `PlaybackPhase.execute` through the online provider path with
// a real container. Only the edges are faked: the provider registry (two
// in-memory providers), the resolve work service, the player, and the Ink
// shell entry points. Everything in between — the phase loop, recovery,
// fallback, control actions, autoplay and post-play routing — is production
// code, so a refactor of the phase has to reproduce these traces exactly.
//
// Runs in its own process because it replaces modules and `globalThis.fetch`,
// and because the container must read an isolated storage root.
import { mock } from "bun:test";

import { createContainer, disposeContainer } from "@/container";
import type { EpisodeInfo, PlaybackResult, StreamInfo, TitleInfo } from "@/domain/types";
import type { PlayerOptions } from "@/infra/player/PlayerService";

const SCENARIOS = [
  "movie-postplay",
  "movie-resolve-fail-dismiss",
  "movie-resolve-fail-retry",
  "movie-dead-stream",
  "movie-fallback-action",
  "movie-resolve-cancel-fallback",
  "movie-resolve-cancel",
  "movie-session-abort-during-resolve",
  "movie-pick-source",
  "movie-cycle-source",
  "movie-switch-title",
  "movie-back-to-search",
  "movie-refresh-action",
  "anime-next",
  "anime-previous",
  "anime-autoplay",
  "anime-postplay-next",
] as const;

const scenario = SCENARIOS.find((name) => name === process.argv[2]);
if (!scenario) throw new Error(`unknown scenario: ${process.argv[2] ?? "(none)"}`);
const anime = scenario.startsWith("anime");

type ResolveRecord = {
  readonly providerId: string;
  readonly episode: number;
  readonly selectedSourceId: string | null;
  readonly selectedStreamId: string | null;
  readonly preferFreshStream: boolean | null;
  readonly forceHealthCheck: boolean | null;
  readonly resolveIntent: string | null;
  readonly blockedStreamUrls: readonly string[];
  readonly intentKind: string;
};

type PlayedRecord = {
  readonly url: string;
  readonly startAt: number;
  readonly resumePromptAt: number;
  readonly episode: number | null;
  readonly provider: string;
};

async function main() {
  const shellCalls: string[] = [];
  const inkShell = await import("@/app-shell/ink-shell");
  mock.module("@/app-shell/ink-shell", () => ({
    ...inkShell,
    openListShell: async () => null,
    openPlaybackShell: async () => {
      shellCalls.push("post-play");
      // The post-play menu is the user's choice point; each scenario answers
      // it the way that flow's user would.
      if (scenario === "anime-postplay-next" && shellCalls.length === 1) return "next";
      return "search";
    },
  }));

  const { PlaybackPhase } = await import("@/app/playback/PlaybackPhase");
  const container = await createContainer({
    searchServiceDefinitions: [],
    providerModulesOverride: [],
  });
  const stop = new AbortController();
  const resolves: ResolveRecord[] = [];
  const prefetches: { providerId: string; episode: number }[] = [];
  const played: PlayedRecord[] = [];
  const feedback: { detail?: string | null; note?: string | null }[] = [];
  const phases: string[] = [];
  const problems: string[] = [];
  const providersSet: string[] = [];
  const fixture = { resolves, prefetches, played, feedback, phases, problems, providersSet };

  const providers = ["alpha", "beta"].map((id) => ({
    metadata: { id, name: id === "alpha" ? "Alpha" : "Beta", isAnimeProvider: anime },
    listEpisodes: anime
      ? async () =>
          [1, 2, 3].map((episode) => ({
            index: episode,
            label: `Episode ${episode}`,
          }))
      : undefined,
  }));
  const providerById = (id: string) => providers.find((provider) => provider.metadata.id === id);

  const title: TitleInfo = anime
    ? // A notification launch names its episode, so the phase auto-launches it
      // instead of opening the "Where to start?" menu.
      {
        id: "anilist:9",
        name: "Fixture Anime",
        type: "series",
        isAnime: true,
        episodeCount: 3,
        launchSource: "notification",
      }
    : { id: "tmdb:7", name: "Fixture Movie", type: "movie" };

  const streamFor = (providerId: string, episode: EpisodeInfo, sourceId = "s1"): StreamInfo => {
    const streamId = `${providerId}-${sourceId}-e${episode.episode}`;
    return {
      url: `https://media.invalid/${streamId}.m3u8`,
      headers: {},
      timestamp: 1,
      providerResolveResult: {
        providerId,
        status: "resolved",
        selectedStreamId: streamId,
        streams: ["s1", "s2"].map((source) => ({
          id: `${providerId}-${source}-e${episode.episode}`,
          providerId,
          sourceId: source,
          url: `https://media.invalid/${providerId}-${source}-e${episode.episode}.m3u8`,
          protocol: "hls",
          confidence: 1,
          cachePolicy: { ttlClass: "stream-manifest", scope: "memory", keyParts: [] },
        })),
        sources: [],
        variants: [],
        subtitles: [],
        failures: [],
        trace: {
          id: `trace-${streamId}`,
          startedAt: "2026-01-01T00:00:00.000Z",
          title: { id: title.id, kind: anime ? "anime" : "movie", title: title.name },
          cacheHit: false,
          steps: [],
          events: [],
          failures: [],
        },
      },
    };
  };

  try {
    await container.config.update({
      autoNext: scenario === "anime-autoplay",
      recommendationRailEnabled: false,
    });
    container.stateManager.dispatch({
      type: "SET_MODE",
      mode: anime ? "anime" : "series",
      provider: "alpha",
    });
    container.stateManager.dispatch({ type: "SELECT_TITLE", title });
    container.stateManager.dispatch({
      type: "SELECT_EPISODE",
      episode: { season: 1, episode: anime && scenario === "anime-previous" ? 2 : 1 },
    });

    globalThis.fetch = Object.assign(
      async () => {
        throw new Error("network forbidden in the playback characterization fixture");
      },
      { preconnect: () => {} },
    );

    Object.assign(container.providerRegistry, {
      get: (id: string) => providerById(id),
      getCompatible: () => providers,
      getManifest: () => undefined,
    });

    const originalDispatch = container.stateManager.dispatch.bind(container.stateManager);
    Object.assign(container.stateManager, {
      dispatch: (action: Parameters<typeof originalDispatch>[0]) => {
        if (action.type === "SET_PLAYBACK_FEEDBACK") {
          fixture.feedback.push({ detail: action.detail, note: action.note });
        }
        if (action.type === "SET_PROVIDER") fixture.providersSet.push(action.provider);
        if (action.type === "SET_PLAYBACK_PROBLEM" && action.problem) {
          fixture.problems.push(action.problem.cause);
        }
        originalDispatch(action);
        // The problem surface waits on the user; answer it like the scenario's user.
        if (action.type === "SET_PLAYBACK_STATUS" && action.status === "error") {
          queueMicrotask(() => {
            const retry = scenario === "movie-resolve-fail-retry" && fixture.resolves.length === 1;
            originalDispatch({ type: "SET_PLAYBACK_STATUS", status: retry ? "loading" : "idle" });
          });
        }
      },
    });

    const originalRecord = container.diagnosticsService.record.bind(container.diagnosticsService);
    Object.assign(container.diagnosticsService, {
      record: (event: Parameters<typeof originalRecord>[0]) => {
        const to = event.context?.to;
        if (event.operation === "playback.session.phase" && to) fixture.phases.push(String(to));
        return originalRecord(event);
      },
    });

    Object.assign(container.playbackResolveWork, {
      resolve: async (
        input: {
          providerId: string;
          episode: EpisodeInfo;
          selectedSourceId?: string;
          selectedStreamId?: string;
          recoveryMode?: string;
          preferFreshStream?: boolean;
          forceHealthCheck?: boolean;
          resolveIntent?: string;
          blockedStreamUrls?: readonly string[];
          signal: AbortSignal;
        },
        request: { intentKind: string; budgetLane: string },
      ) => {
        fixture.resolves.push({
          providerId: input.providerId,
          episode: input.episode.episode,
          selectedSourceId: input.selectedSourceId ?? null,
          selectedStreamId: input.selectedStreamId ?? null,
          preferFreshStream: input.preferFreshStream ?? null,
          forceHealthCheck: input.forceHealthCheck ?? null,
          resolveIntent: input.resolveIntent ?? null,
          blockedStreamUrls: input.blockedStreamUrls ?? [],
          intentKind: request.intentKind,
        });
        const call = fixture.resolves.length;
        const failed = {
          stream: null,
          providerId: input.providerId,
          attempts: [
            {
              providerId: input.providerId,
              failure: {
                providerId: input.providerId,
                code: "not-found",
                message: "No streams",
                retryable: false,
                at: "2026-01-01T00:00:00.000Z",
              },
            },
          ],
          cacheStatus: "miss",
          cacheProvenance: "fresh",
          provenance: "fresh",
        };
        if (scenario === "movie-resolve-fail-dismiss") return failed;
        if (scenario === "movie-resolve-fail-retry" && call === 1) return failed;
        if (scenario === "movie-session-abort-during-resolve") {
          stop.abort("session-shutdown");
          throw new DOMException("session-shutdown", "AbortError");
        }
        if (scenario === "movie-resolve-cancel" && call === 1) {
          container.workControl.cancelActive("user-requested");
          throw new DOMException("user-requested", "AbortError");
        }
        if (scenario === "movie-resolve-cancel-fallback" && call === 1) {
          container.workControl.cancelActive("provider-fallback");
          return {
            stream: null,
            providerId: input.providerId,
            attempts: [{ providerId: input.providerId, aborted: true }],
            cacheStatus: "miss",
            cacheProvenance: "fresh",
            provenance: "fresh",
          };
        }
        const stream = streamFor(input.providerId, input.episode, input.selectedSourceId ?? "s1");
        return {
          stream,
          providerId: input.providerId,
          attempts: [{ providerId: input.providerId, stream }],
          cacheStatus: "miss",
          cacheProvenance: "fresh",
          provenance: "fresh",
        };
      },
      prefetch: async (input: { providerId: string; episode: EpisodeInfo }) => {
        fixture.prefetches.push({ providerId: input.providerId, episode: input.episode.episode });
        return {
          stream: streamFor(input.providerId, input.episode),
          providerId: input.providerId,
          cacheProvenance: "fresh",
        };
      },
    });

    const control = container.playerControl;
    Object.assign(container.player, {
      isAvailable: async () => true,
      releasePersistentSession: async () => {},
      play: async (stream: StreamInfo, options: PlayerOptions): Promise<PlaybackResult> => {
        fixture.played.push({
          url: stream.url,
          startAt: options.startAt ?? 0,
          resumePromptAt: options.resumePromptAt ?? 0,
          episode: container.stateManager.getState().currentEpisode?.episode ?? null,
          provider: container.stateManager.getState().provider,
        });
        const playIndex = fixture.played.length;
        const generation = { process: 1, cycle: playIndex };
        options.onGenerationActivated?.(generation);
        options.onPlaybackEvent?.({ generation, event: { type: "playback-started" } });
        options.onPlaybackEvent?.({
          generation,
          event: { type: "playback-progress", positionSeconds: 40, durationSeconds: 1200 },
        });
        const quit: PlaybackResult = {
          endReason: "quit",
          watchedSeconds: 40,
          duration: 1200,
          lastNonZeroPositionSeconds: 40,
          lastNonZeroDurationSeconds: 1200,
          playerExitCode: 0,
          playerExitSignal: null,
        };
        const first = playIndex === 1;
        const finish = (): PlaybackResult => {
          stop.abort("fixture-complete");
          return quit;
        };
        switch (scenario) {
          case "movie-postplay":
          case "movie-resolve-fail-retry":
            return quit;
          case "movie-dead-stream":
            if (!first) return finish();
            return {
              ...quit,
              endReason: "error",
              watchedSeconds: 0,
              lastNonZeroPositionSeconds: 0,
              suspectedDeadStream: true,
              playerExitCode: 2,
            };
          case "movie-fallback-action":
            if (!first) return finish();
            control.signalPlaybackAction("fallback");
            return quit;
          case "movie-refresh-action":
            if (!first) return finish();
            control.signalPlaybackAction("refresh");
            return quit;
          case "movie-pick-source":
            if (!first) return finish();
            await control.selectCurrentPlaybackStream("pick-source", {
              sourceId: "s2",
              streamId: null,
            });
            return quit;
          case "movie-cycle-source":
            if (!first) return finish();
            control.signalPlaybackAction("cycle-source");
            return quit;
          case "movie-switch-title":
            control.signalTitleSwitch({
              title: { id: "tmdb:99", name: "Other", type: "movie" },
            });
            return quit;
          case "movie-back-to-search":
            control.signalPlaybackAction("back-to-search");
            return quit;
          case "anime-next":
            if (!first) return finish();
            control.signalPlaybackAction("next");
            return quit;
          case "anime-previous":
            if (!first) return finish();
            control.signalPlaybackAction("previous");
            return quit;
          case "anime-autoplay":
            if (!first) return finish();
            options.onNearEof?.();
            return {
              ...quit,
              endReason: "eof",
              watchedSeconds: 1200,
              lastNonZeroPositionSeconds: 1200,
            };
          case "anime-postplay-next":
            return first ? quit : finish();
          default:
            return finish();
        }
      },
    });

    const phase = new PlaybackPhase();
    // The countdown UI has injected-clock tests of its own; skip only its wait.
    Object.assign(phase, { runAutoNextCountdown: async () => "continue" });
    const result = await phase.execute(title, { container, signal: stop.signal });
    const state = container.stateManager.getState();
    console.log(
      "RESULT " +
        JSON.stringify({
          result,
          ...fixture,
          shellCalls,
          provider: state.provider,
          currentEpisode: state.currentEpisode?.episode ?? null,
          playbackStatus: state.playbackStatus,
        }),
    );
  } finally {
    await disposeContainer(container);
  }
}

await main();
