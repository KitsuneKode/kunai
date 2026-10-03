import { join } from "node:path";

import { PlaybackPhase } from "@/app/playback/PlaybackPhase";
import { createContainer, disposeContainer } from "@/container";
import type { PlaybackResult, TitleInfo } from "@/domain/types";
import type { PlayerOptions } from "@/infra/player/PlayerService";
import { DownloadJobsRepository } from "@kunai/storage";

const scenario = process.argv[2] ?? "movie";
const container = await createContainer({
  providerModulesOverride: [],
  searchServiceDefinitions: [],
});
const stop = new AbortController();
const calls = { registry: 0, health: 0, cache: 0, selection: 0, trace: 0, network: 0 };
const played: PlayerOptions[] = [];
const sourceProvider = "retired-provider";
const fixtureRoot = process.env.HOME;
if (!fixtureRoot) throw new Error("isolated HOME is required");
const anime = scenario.startsWith("anime");
const series = anime || scenario.startsWith("series");
const autoplay = scenario.endsWith("autoplay");
const playerFailure = scenario === "movie-error";
const offline = scenario !== "online" && scenario !== "continue-local";
const title: TitleInfo = {
  id: anime ? "anilist:1" : "tmdb:1",
  name: "Owned local fixture",
  type: series ? "series" : "movie",
  isAnime: anime,
  launchSource: offline ? "offline-library" : "continue",
};

try {
  await container.config.update({ autoNext: autoplay, recommendationRailEnabled: false });
  container.stateManager.dispatch({
    type: "SET_MODE",
    mode: anime ? "anime" : "series",
    provider: sourceProvider,
  });
  container.stateManager.dispatch({ type: "SELECT_TITLE", title });
  container.stateManager.dispatch({ type: "SELECT_EPISODE", episode: { season: 1, episode: 1 } });
  const jobs = new DownloadJobsRepository(container.dataDb);
  for (let episode = 1; episode <= (scenario === "online" ? 0 : series ? 2 : 1); episode++) {
    const filePath = join(fixtureRoot, `owned-${episode}.mp4`);
    const subtitlePath = join(fixtureRoot, `owned-${episode}.srt`);
    if (scenario !== "missing")
      await Bun.write(filePath, scenario === "invalid" ? "" : "owned nonempty fixture");
    await Bun.write(subtitlePath, "1\n00:00:00,000 --> 00:00:01,000\nOwned subtitle\n");
    const now = new Date().toISOString();
    jobs.enqueue({
      id: `job-${episode}`,
      titleId: title.id,
      titleName: title.name,
      mediaKind: anime ? "anime" : series ? "series" : "movie",
      mode: anime ? "anime" : "series",
      providerId: sourceProvider,
      season: series ? 1 : undefined,
      episode: series ? episode : undefined,
      streamUrl: "https://example.invalid/unreachable",
      headers: {},
      outputPath: filePath,
      tempPath: `${filePath}.tmp`,
      createdAt: now,
      updatedAt: now,
    });
    jobs.updateOfflineMetadata(
      `job-${episode}`,
      {
        subtitlePath,
        subtitleLanguage: "en",
        introSkipJson: JSON.stringify({ intro: { start: 0, end: 10 } }),
      },
      now,
    );
    jobs.complete(`job-${episode}`, now);
    jobs.markArtifactValidated(`job-${episode}`, "ready", now);
    const completed = jobs.get(`job-${episode}`);
    if (!completed) throw new Error("completed fixture job missing");
    container.offlineAssetService.adoptCompletedJob(completed);
  }

  if (scenario === "series-resume") {
    container.historyRepository.upsertProgress({
      title: { id: title.id, kind: "series", title: title.name },
      episode: { season: 1, episode: 2 },
      positionSeconds: 30,
      durationSeconds: 120,
      completed: false,
      providerId: sourceProvider,
      updatedAt: new Date().toISOString(),
    });
  }

  container.providerRegistry.get = () => {
    calls.registry++;
    return undefined;
  };
  container.providerRegistry.getCompatible = () => {
    calls.registry++;
    return [];
  };
  container.providerHealth.get = () => {
    calls.health++;
    return undefined;
  };
  container.providerHealth.set = () => {
    calls.health++;
  };
  container.titleProviderHealth.recordFailure = () => {
    calls.health++;
  };
  container.titleProviderHealth.recordCleanSuccess = () => {
    calls.health++;
  };
  container.titleProviderHealth.getSwitchSuggestion = () => {
    calls.health++;
    return null;
  };
  container.cacheStore.delete = async () => {
    calls.cache++;
  };
  container.sourceInventory.delete = async () => {
    calls.cache++;
  };
  container.episodePlaybackSelection.get = async () => {
    calls.selection++;
    return null;
  };
  container.titlePlaybackSource.get = async () => {
    calls.selection++;
    return null;
  };
  container.resolveTraceSink.record = () => {
    calls.trace++;
  };
  globalThis.fetch = (async () => {
    calls.network++;
    throw new Error("network forbidden in local playback");
  }) as unknown as typeof fetch;
  Object.assign(container.player, {
    isAvailable: async () => true,
    releasePersistentSession: async () => {},
    play: async (_stream: unknown, options: PlayerOptions): Promise<PlaybackResult> => {
      played.push(options);
      const generation = { process: 1, cycle: played.length };
      options.onGenerationActivated?.(generation);
      options.onPlaybackEvent?.({ generation, event: { type: "playback-started" } });
      options.onPlaybackEvent?.({
        generation,
        event: { type: "playback-progress", positionSeconds: 20, durationSeconds: 120 },
      });
      options.onNearEof?.();
      if (series && played.length === 1 && !autoplay)
        container.playerControl.signalPlaybackAction("next");
      else if (!playerFailure && !(autoplay && played.length === 1))
        stop.abort("test verified handoff");
      return {
        endReason: playerFailure ? "error" : autoplay && played.length === 1 ? "eof" : "quit",
        watchedSeconds: autoplay && played.length === 1 ? 120 : 20,
        duration: 120,
        lastNonZeroPositionSeconds: 20,
        lastNonZeroDurationSeconds: 120,
        suspectedDeadStream: playerFailure,
        playerExitCode: playerFailure ? 1 : 0,
        playerExitSignal: null,
      };
    },
  });

  // The countdown UI has its own injected-clock tests; bypass only that UI
  // wait while exercising the real phase's EOF policy and prefetch handoff.
  const phase = new PlaybackPhase();
  Object.assign(phase, { runAutoNextCountdown: async () => "continue" });
  const result = await phase.execute(title, { container, signal: stop.signal });
  console.log(
    "RESULT " +
      JSON.stringify({
        result,
        calls,
        problem: container.stateManager.getState().playbackProblem,
        played: played.map((options) => ({
          filePath: options.localPlaybackSource?.filePath,
          subtitle: options.subtitle,
          subtitlePath: options.localPlaybackSource?.subtitlePath,
          providerId: options.localPlaybackSource?.providerId,
          startAt: options.startAt,
          resumePromptAt: options.resumePromptAt,
          timing: options.timing,
          generationHook: typeof options.onGenerationActivated === "function",
          abortSignal: options.abortSignal === stop.signal,
        })),
      }),
  );
} finally {
  await disposeContainer(container);
}
