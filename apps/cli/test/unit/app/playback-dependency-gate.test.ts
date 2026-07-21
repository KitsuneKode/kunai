import { describe, expect, test } from "bun:test";

import {
  buildMpvRemediation,
  gatePlaybackDependencies,
} from "@/app/playback/playback-dependency-gate";
import { PlaybackPhase } from "@/app/playback/PlaybackPhase";
import type { PhaseContext } from "@/app/session/Phase";

describe("buildMpvRemediation", () => {
  test("linux guidance prefers apt", () => {
    const remediation = buildMpvRemediation("linux");
    expect(remediation.platform).toBe("linux");
    expect(remediation.commands.some((command) => command.includes("apt install mpv"))).toBe(true);
  });

  test("macOS guidance uses brew", () => {
    const remediation = buildMpvRemediation("darwin");
    expect(remediation.platform).toBe("darwin");
    expect(remediation.commands).toContain("brew install mpv");
  });

  test("Windows guidance uses winget mpv.net", () => {
    const remediation = buildMpvRemediation("win32");
    expect(remediation.platform).toBe("win32");
    expect(remediation.commands).toContain("winget install --id mpv.net -e");
  });
});

describe("gatePlaybackDependencies", () => {
  test("missing mpv blocks playback with Linux guidance", async () => {
    const result = await gatePlaybackDependencies({
      player: { isAvailable: async () => false },
      platform: "linux",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected blocked playback");
    expect(result.dependency).toBe("mpv");
    expect(result.problem.cause).toBe("mpv-missing");
    expect(result.problem.userMessage).toContain("apt install mpv");
    expect(result.remediation.platform).toBe("linux");
  });

  test("missing mpv blocks playback with macOS guidance", async () => {
    const result = await gatePlaybackDependencies({
      player: { isAvailable: async () => false },
      platform: "darwin",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected blocked playback");
    expect(result.problem.cause).toBe("mpv-missing");
    expect(result.problem.userMessage).toContain("brew install mpv");
  });

  test("missing mpv blocks playback with Windows guidance", async () => {
    const result = await gatePlaybackDependencies({
      player: { isAvailable: async () => false },
      platform: "win32",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected blocked playback");
    expect(result.problem.cause).toBe("mpv-missing");
    expect(result.problem.userMessage).toContain("winget install --id mpv.net -e");
  });

  test("available mpv passes the gate", async () => {
    const result = await gatePlaybackDependencies({
      player: { isAvailable: async () => true },
      platform: "linux",
    });
    expect(result).toEqual({ ok: true });
  });
});

describe("PlaybackPhase mpv dependency boundary", () => {
  test("missing mpv returns to results without provider resolve or history checkpoints", async () => {
    let providerResolveCalls = 0;
    let historyCheckpointStarts = 0;
    let providerRegistryReads = 0;
    let historyReads = 0;
    const recorded: Array<{ message?: string; context?: Record<string, unknown> }> = [];

    const context = {
      signal: new AbortController().signal,
      container: {
        providerRegistry: {
          get: () => {
            providerRegistryReads += 1;
            return {
              resolve: async () => {
                providerResolveCalls += 1;
                throw new Error("provider must stay untouched");
              },
              listEpisodes: async () => {
                providerResolveCalls += 1;
                throw new Error("provider must stay untouched");
              },
            };
          },
        },
        stateManager: {
          getState: () => ({
            provider: "allanime",
            mode: "anime",
            autoplaySessionPaused: false,
            stopAfterCurrent: false,
            providerSwitchSeq: 0,
            currentTitle: null,
            currentEpisode: null,
            videoMeta: null,
          }),
          dispatch: () => {},
          subscribe: () => () => {},
        },
        logger: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} },
        historyRepository: {
          getLatestForTitleIdentity: () => {
            historyReads += 1;
            return null;
          },
          getResumeOffer: () => {
            historyReads += 1;
            return null;
          },
        },
        config: {
          autoNext: false,
          quitNearEndThresholdMode: "default",
          provider: "allanime",
          animeProvider: "allanime",
        },
        cacheStore: {},
        diagnosticsService: {
          record: (event: { message?: string; context?: Record<string, unknown> }) => {
            recorded.push(event);
          },
        },
        playerControl: {
          getActive: () => null,
          consumeLastAction: () => null,
          setActive: () => {},
        },
        player: {
          isAvailable: async () => false,
          releasePersistentSession: async () => {},
          killActiveMpvProcessesSync: () => {},
          beginShutdown: () => {},
        },
        workControl: { setActive: () => {} },
        episodePlaybackSelection: {
          get: () => null,
          set: async () => {},
        },
        titlePlaybackSource: {
          get: () => null,
          set: async () => {},
        },
        queueService: null,
        providerHealth: { get: () => null },
        presence: {
          updatePlayback: async () => {},
          clearPlayback: async () => {},
        },
        playbackHistoryLedgerFactory: () => {
          historyCheckpointStarts += 1;
          return {
            start: () => {
              historyCheckpointStarts += 1;
            },
          };
        },
      },
    } as unknown as PhaseContext;

    const result = await new PlaybackPhase().execute(
      { id: "anilist:1", type: "series", name: "Demo", isAnime: true },
      context,
    );

    expect(result).toEqual({ status: "success", value: "back_to_results" });
    expect(providerResolveCalls).toBe(0);
    expect(historyCheckpointStarts).toBe(0);
    expect(providerRegistryReads).toBe(0);
    expect(historyReads).toBe(0);
    expect(
      recorded.some(
        (event) =>
          event.context?.cause === "mpv-missing" ||
          event.message?.toLowerCase().includes("mpv") === true,
      ),
    ).toBe(true);
  });
});
