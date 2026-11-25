// Characterization net for `PlaybackPhase.execute` on the online provider path
// (plan 010 step 2 / plan 012 step 1). Each scenario drives the real phase
// through `fixtures/provider-playback-phase.ts` in a shared isolated child
// and pins what a user can observe: the phase result, every resolve the phase
// asked for (provider, source pin, recovery intent, blocked dead URLs), every
// stream handed to the player (with its start/resume offset), the session
// phase walk, the problems shown, provider switches and post-play entries.
//
// These traces were recorded before `PlaybackPhase` was split into modules.
// A refactor that changes any of them changed behavior.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { storageRootEnv } from "../helpers/storage-env";
import type { ScenarioReply } from "./fixtures/provider-playback-phase";

type Report = Extract<ScenarioReply, { report: unknown }>["report"];
type ResolveCall = Report["resolves"][number];

let root: string | undefined;
let worker: ReturnType<typeof startWorker> | undefined;
let pending: ReturnType<typeof Promise.withResolvers<ScenarioReply>> | undefined;

function startWorker(dir: string, ready: () => void) {
  const child = Bun.spawn({
    cmd: [process.execPath, join(import.meta.dir, "fixtures/provider-playback-phase.ts"), dir],
    cwd: join(import.meta.dir, "../.."),
    env: { ...process.env, ...storageRootEnv(dir) },
    stdout: "ignore",
    stderr: "pipe",
    ipc(message: "ready" | ScenarioReply) {
      if (message === "ready") ready();
      else pending?.resolve(message);
    },
  });
  const stderr = new Response(child.stderr).text();
  const failed = child.exited.then(async (code) => {
    throw new Error(`Playback fixture worker exited (${code}): ${await stderr}`);
  });
  return { child, failed };
}

async function runScenario(scenario: ScenarioReply["scenario"]): Promise<Report> {
  if (!worker) throw new Error("Playback fixture worker has not started");
  if (pending) throw new Error("The previous playback scenario is still running");
  pending = Promise.withResolvers<ScenarioReply>();
  try {
    if (worker.child.exitCode !== null) return await worker.failed;
    worker.child.send(scenario);
    const reply = await Promise.race([pending.promise, worker.failed]);
    if (reply.scenario !== scenario)
      throw new Error(`Unexpected fixture reply for ${reply.scenario}`);
    if ("error" in reply) throw new Error(reply.error);
    return reply.report;
  } finally {
    pending = undefined;
  }
}

const url = (stream: string) => `https://media.invalid/${stream}.m3u8`;

function resolve(overrides: Partial<ResolveCall> = {}): ResolveCall {
  return {
    providerId: "alpha",
    episode: 1,
    selectedSourceId: null,
    selectedStreamId: null,
    preferFreshStream: false,
    forceHealthCheck: false,
    resolveIntent: "play",
    blockedStreamUrls: [],
    intentKind: "playback",
    ...overrides,
  };
}

function played(stream: string, startAt = 0, resumePromptAt = 0, episode = 1, provider = "alpha") {
  return { url: url(stream), startAt, resumePromptAt, episode, provider };
}

// A recovery resolve skips cached answers and re-probes provider health.
const FRESH_RECOVERY = { preferFreshStream: true, forceHealthCheck: true } as const;

const PLAY = ["resolving", "ready", "playing"];
const PLAY_ENDED = [...PLAY, "ending"];

describe("PlaybackPhase.execute characterization (online provider path)", () => {
  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "kunai-playback-phase-"));
    const ready = Promise.withResolvers<void>();
    worker = startWorker(root, ready.resolve);
    await Promise.race([ready.promise, worker.failed]);
  });

  afterAll(async () => {
    if (worker) {
      // Each reply follows scenario disposal. Kill the idle worker, or interrupt
      // a scenario that failed to finish, before removing its isolated storage.
      worker.child.kill();
      await worker.child.exited;
    }
    if (root) rmSync(root, { recursive: true, force: true, maxRetries: 10 });
  });

  test("resolve → play → quit opens post-play once and leaves for search", async () => {
    const report = await runScenario("movie-postplay");
    expect(report.result).toEqual({ status: "success", value: "back_to_search" });
    expect(report.resolves).toEqual([resolve()]);
    expect(report.played).toEqual([played("alpha-s1-e1")]);
    expect(report.phases).toEqual([...PLAY_ENDED, "post-playback"]);
    expect(report.shellCalls).toEqual(["post-play"]);
    expect(report.playbackStatus).toBe("idle");
    expect(report.feedback).toContainEqual({
      detail: "Resolving provider stream",
      note: "Esc cancel · returns to results",
    });
  });

  test("a failed resolve shows the problem and a dismissal returns to results", async () => {
    const report = await runScenario("movie-resolve-fail-dismiss");
    expect(report.result).toEqual({ status: "success", value: "back_to_results" });
    expect(report.resolves).toEqual([resolve()]);
    expect(report.played).toEqual([]);
    expect(report.phases).toEqual(["resolving", "failed"]);
    expect(report.problems).toEqual(["no-stream"]);
  });

  test("retrying a failed resolve asks for fresh sources as a recovery", async () => {
    const report = await runScenario("movie-resolve-fail-retry");
    expect(report.result).toEqual({ status: "success", value: "back_to_search" });
    expect(report.resolves).toEqual([
      resolve(),
      resolve({ ...FRESH_RECOVERY, resolveIntent: "refresh", intentKind: "recovery" }),
    ]);
    expect(report.played).toEqual([played("alpha-s1-e1")]);
    expect(report.phases).toEqual(["resolving", "failed", ...PLAY_ENDED, "post-playback"]);
    expect(report.feedback).toContainEqual({
      detail: "Retrying with fresh provider sources…",
      note: "Cached failures and stale source inventory are bypassed for this attempt.",
    });
  });

  test("a dead stream blocks its URL and fails over to the next source", async () => {
    const report = await runScenario("movie-dead-stream");
    expect(report.result).toEqual({ status: "cancelled" });
    expect(report.resolves).toEqual([
      resolve(),
      resolve({
        selectedSourceId: "s2",
        ...FRESH_RECOVERY,
        intentKind: "recovery",
        blockedStreamUrls: [url("alpha-s1-e1")],
      }),
    ]);
    expect(report.played).toEqual([played("alpha-s1-e1"), played("alpha-s2-e1")]);
    expect(report.phases).toEqual([...PLAY_ENDED, "recovering", ...PLAY]);
  });

  test("the fallback control switches provider and resumes where playback stopped", async () => {
    const report = await runScenario("movie-fallback-action");
    expect(report.result).toEqual({ status: "cancelled" });
    expect(report.resolves).toEqual([
      resolve(),
      resolve({ providerId: "beta", ...FRESH_RECOVERY, intentKind: "recovery" }),
    ]);
    expect(report.played).toEqual([played("alpha-s1-e1"), played("beta-s1-e1", 0, 40, 1, "beta")]);
    expect(report.providersSet).toEqual(["beta"]);
    expect(report.provider).toBe("beta");
    expect(report.phases).toEqual([...PLAY_ENDED, ...PLAY]);
  });

  test("the refresh control re-resolves the same provider from the stop position", async () => {
    const report = await runScenario("movie-refresh-action");
    expect(report.result).toEqual({ status: "cancelled" });
    expect(report.resolves).toEqual([resolve(), resolve({ preferFreshStream: true })]);
    expect(report.played).toEqual([played("alpha-s1-e1"), played("alpha-s1-e1", 40)]);
    expect(report.phases).toEqual([...PLAY_ENDED, "recovering", ...PLAY]);
  });

  test("skipping the provider during resolve walks to the next untried provider", async () => {
    const report = await runScenario("movie-resolve-cancel-fallback");
    expect(report.result).toEqual({ status: "cancelled" });
    expect(report.resolves).toEqual([
      resolve(),
      resolve({ providerId: "beta", ...FRESH_RECOVERY }),
    ]);
    expect(report.played).toEqual([played("beta-s1-e1", 0, 0, 1, "beta")]);
    expect(report.providersSet).toEqual(["beta"]);
    expect(report.phases).toEqual(PLAY);
    expect(report.feedback).toContainEqual({
      detail: "Trying Beta…",
      note: "Fallback provider selected for the rest of this session",
    });
  });

  test("cancelling the resolve returns to results without playing", async () => {
    const report = await runScenario("movie-resolve-cancel");
    expect(report.result).toEqual({ status: "success", value: "back_to_results" });
    expect(report.resolves).toEqual([resolve()]);
    expect(report.played).toEqual([]);
    expect(report.phases).toEqual(["resolving"]);
    expect(report.playbackStatus).toBe("idle");
  });

  test("a session shutdown during resolve cancels the phase", async () => {
    const report = await runScenario("movie-session-abort-during-resolve");
    expect(report.result).toEqual({ status: "cancelled" });
    expect(report.played).toEqual([]);
    expect(report.phases).toEqual(["resolving"]);
  });

  test("a confirmed source pick re-resolves pinned to that source", async () => {
    const report = await runScenario("movie-pick-source");
    expect(report.result).toEqual({ status: "cancelled" });
    expect(report.resolves).toEqual([
      resolve(),
      resolve({ selectedSourceId: "s2", ...FRESH_RECOVERY, intentKind: "recovery" }),
    ]);
    expect(report.played).toEqual([played("alpha-s1-e1"), played("alpha-s2-e1", 0, 40)]);
    expect(report.phases).toEqual([...PLAY_ENDED, ...PLAY]);
  });

  test("cycling the source advances to the next source in the inventory", async () => {
    const report = await runScenario("movie-cycle-source");
    expect(report.result).toEqual({ status: "cancelled" });
    expect(report.resolves).toEqual([
      resolve(),
      resolve({ selectedSourceId: "s2", ...FRESH_RECOVERY, intentKind: "recovery" }),
    ]);
    expect(report.played).toEqual([played("alpha-s1-e1"), played("alpha-s2-e1", 0, 40)]);
  });

  test("a title switch during playback exits with the new title", async () => {
    const report = await runScenario("movie-switch-title");
    expect(report.result).toEqual({
      status: "success",
      value: {
        type: "history_entry",
        title: { id: "tmdb:99", name: "Other", type: "movie" },
      },
    });
    expect(report.played).toEqual([played("alpha-s1-e1")]);
    expect(report.phases).toEqual(PLAY_ENDED);
  });

  test("back-to-search during playback leaves without post-play", async () => {
    const report = await runScenario("movie-back-to-search");
    expect(report.result).toEqual({ status: "success", value: "back_to_search" });
    expect(report.shellCalls).toEqual([]);
    expect(report.phases).toEqual(PLAY_ENDED);
  });

  test("next during playback hands off to the following episode through prefetch", async () => {
    const report = await runScenario("anime-next");
    expect(report.result).toEqual({ status: "cancelled" });
    expect(report.resolves).toEqual([resolve()]);
    expect(report.prefetches).toEqual([{ providerId: "alpha", episode: 2 }]);
    expect(report.played).toEqual([played("alpha-s1-e1"), played("alpha-s1-e2", 0, 0, 2)]);
    expect(report.currentEpisode).toBe(2);
    expect(report.phases).toEqual([...PLAY_ENDED, ...PLAY]);
  });

  test("previous during playback resolves the earlier episode directly", async () => {
    const report = await runScenario("anime-previous");
    expect(report.result).toEqual({ status: "cancelled" });
    expect(report.resolves).toEqual([resolve({ episode: 2 }), resolve({ episode: 1 })]);
    expect(report.prefetches).toEqual([]);
    expect(report.played).toEqual([played("alpha-s1-e2", 0, 0, 2), played("alpha-s1-e1")]);
    expect(report.currentEpisode).toBe(1);
  });

  test("autoplay at EOF marks the episode complete and plays the prefetched next one", async () => {
    const report = await runScenario("anime-autoplay");
    expect(report.result).toEqual({ status: "cancelled" });
    expect(report.resolves).toEqual([resolve()]);
    expect(report.prefetches).toEqual([{ providerId: "alpha", episode: 2 }]);
    expect(report.played).toEqual([played("alpha-s1-e1"), played("alpha-s1-e2", 0, 0, 2)]);
    expect(report.shellCalls).toEqual([]);
    expect(report.phases).toEqual([...PLAY_ENDED, ...PLAY]);
    expect(report.feedback).toContainEqual({
      note: "✓ Fixture Anime S01E01 · episode complete",
    });
    expect(report.feedback.filter(({ detail }) => detail === "Auto-next ready")).toHaveLength(3);
    expect(report.feedback).toContainEqual({ detail: "Loading next episode", note: "S01E02" });
  });

  test("Next from the post-play menu resolves and plays the following episode", async () => {
    const report = await runScenario("anime-postplay-next");
    expect(report.result).toEqual({ status: "cancelled" });
    expect(report.resolves).toEqual([resolve(), resolve({ episode: 2 })]);
    expect(report.played).toEqual([played("alpha-s1-e1"), played("alpha-s1-e2", 0, 0, 2)]);
    expect(report.shellCalls).toEqual(["post-play"]);
    expect(report.phases).toEqual([...PLAY_ENDED, "post-playback", ...PLAY]);
  });
});
