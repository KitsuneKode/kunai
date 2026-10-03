import { mock } from "bun:test";
import { join } from "node:path";

import { buildTracksPanelData } from "@/app-shell/tracks-panel-data";
import { createContainer, disposeContainer } from "@/container";
import type { PlaybackResult, StreamInfo, TitleInfo } from "@/domain/types";
import type { PlayerOptions } from "@/infra/player/PlayerService";
import { DownloadJobsRepository } from "@kunai/storage";

async function main() {
  const scenario = process.argv[2] ?? "movie";
  const postplay = scenario.includes("postplay");
  const tracks = scenario === "movie-postplay-tracks";
  const pickerValues: string[] = [];
  let panelProviderRows = 0;
  let shellCalls = 0;
  const inkShell = await import("@/app-shell/ink-shell");
  if (postplay) {
    // Mock UI input only in this isolated child; container, index and phase are real.
    mock.module("@/app-shell/ink-shell", () => ({
      ...inkShell,
      openListShell: async () => null,
      openPlaybackShell: async ({ container }: { container: import("@/container").Container }) => {
        if (++shellCalls > 1) return "search";
        if (!tracks) return "pick-episode";
        const panel = await buildTracksPanelData(
          container.stateManager.getState().stream,
          container,
        );
        panelProviderRows =
          panel.groups
            .find((group) => group.section === "provider")
            ?.rows.filter((row) => row.enabled).length ?? 0;
        // A stale/forged selection must also be refused at the application boundary.
        return { type: "track-selection", pick: { section: "provider", value: "vidlink" } };
      },
    }));
    const sessionPicker = await import("@/app-shell/session-picker");
    mock.module("@/app-shell/session-picker", () => ({
      ...sessionPicker,
      openSessionPicker: async (
        _manager: Parameters<typeof sessionPicker.openSessionPicker>[0],
        picker: { options: readonly { value: string }[] },
      ) => {
        pickerValues.push(...picker.options.map((row) => row.value));
        return picker.options[1]?.value ?? null;
      },
    }));
  }
  const { PlaybackPhase } = await import("@/app/playback/PlaybackPhase");
  const containerOptions: Parameters<typeof createContainer>[0] = { searchServiceDefinitions: [] };
  if (!tracks) containerOptions.providerModulesOverride = [];
  const container = await createContainer(containerOptions);
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
        providerEpisodeIdentity: anime
          ? { providerId: sourceProvider, value: episode === 1 ? "0" : "OVA" }
          : undefined,
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

    const originalGet = container.providerRegistry.get.bind(container.providerRegistry);
    container.providerRegistry.get = (id) => {
      calls.registry++;
      return tracks ? originalGet(id) : undefined;
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
    globalThis.fetch = Object.assign(
      async () => {
        calls.network++;
        throw new Error("network forbidden in local playback");
      },
      { preconnect: () => {} },
    );
    Object.assign(container.player, {
      isAvailable: async () => true,
      releasePersistentSession: async () => {},
      play: async (_stream: StreamInfo, options: PlayerOptions): Promise<PlaybackResult> => {
        played.push(options);
        const generation = { process: 1, cycle: played.length };
        options.onGenerationActivated?.(generation);
        options.onPlaybackEvent?.({ generation, event: { type: "playback-started" } });
        options.onPlaybackEvent?.({
          generation,
          event: { type: "playback-progress", positionSeconds: 20, durationSeconds: 120 },
        });
        options.onNearEof?.();
        if (series && played.length === 1 && !autoplay && !postplay)
          container.playerControl.signalPlaybackAction("next");
        else if (
          !playerFailure &&
          !(autoplay && played.length === 1) &&
          !(postplay && played.length === 1)
        )
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
          pickerValues,
          panelProviderRows,
          provider: container.stateManager.getState().provider,
          currentEpisode: container.stateManager.getState().currentEpisode,
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
            generationHook: options.onGenerationActivated !== undefined,
            abortSignal: options.abortSignal === stop.signal,
          })),
        }),
    );
  } finally {
    await disposeContainer(container);
  }
}

await main();
