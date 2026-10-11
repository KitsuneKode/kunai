import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { storageRootEnv } from "../helpers/storage-env";

async function runScenario(scenario: string) {
  const dir = mkdtempSync(join(tmpdir(), "kunai-retired-provider-"));
  try {
    const child = Bun.spawn(
      [process.execPath, join(import.meta.dir, "fixtures/retired-provider-playback.ts"), scenario],
      {
        cwd: join(import.meta.dir, "../.."),
        env: { ...process.env, ...storageRootEnv(dir) },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(code, stderr).toBe(0);
    const record = stdout.split("\n").find((line) => line.startsWith("RESULT "));
    if (!record) throw new Error(`missing fixture result: ${stderr}`);
    return { dir, ...JSON.parse(record.slice(7)) };
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
}

describe("retired-provider playback through the real container and phase", () => {
  test("selected anime identity wins over a newer artifact at the same numeric episode", async () => {
    const report = await runScenario("anime-selected-identity");
    expect(report.played).toHaveLength(1);
    expect(report.played[0].filePath).toBe(join(report.dir, "owned-1.mp4"));
    expect(report.currentEpisode.providerEpisodeIdentity).toEqual({
      providerId: "retired-provider",
      value: "0",
    });
  });
  test("initial offline selection never inherits another episode's resume position", async () => {
    const report = await runScenario("series-initial-other-history");
    expect(report.played).toHaveLength(1);
    expect(report.played[0].filePath).toBe(join(report.dir, "owned-2.mp4"));
    expect(report.played[0].startAt).toBe(0);
    expect(report.played[0].resumePromptAt).toBe(0);
  });
  test("initial offline selection resumes history for that exact episode", async () => {
    const report = await runScenario("series-initial-matching-history");
    expect(report.played).toHaveLength(1);
    expect(report.played[0].filePath).toBe(join(report.dir, "owned-2.mp4"));
    expect(report.played[0].startAt).toBe(90);
  });
  test("Continue honors an explicit online preference even when a local file exists", async () => {
    const report = await runScenario("continue-local-stream-preference");
    expect(report.played).toEqual([]);
    expect(report.calls.registry).toBeGreaterThan(0);
    expect(report.result).toMatchObject({
      status: "error",
      error: { code: "PROVIDER_UNAVAILABLE" },
    });
  });
  for (const scenario of ["continue-local", "series-continue-local", "anime-continue-local"])
    test(`${scenario}: Continue resolves a valid local choice before provider or remote metadata work`, async () => {
      const report = await runScenario(scenario);
      expect(report.played[0].filePath).toBe(join(report.dir, "owned-1.mp4"));
      expect(report.calls).toEqual({
        registry: 0,
        health: 0,
        cache: 0,
        selection: 0,
        trace: 0,
        network: 0,
      });
    });
  for (const scenario of ["movie", "series", "anime", "series-autoplay", "anime-autoplay"]) {
    test(`${scenario}: verified file and sidecar reach the shared player without provider work`, async () => {
      const report = await runScenario(scenario);
      expect(report.played.length).toBe(scenario === "movie" ? 1 : 2);
      expect(report.result.status).toBe("cancelled");
      expect(report.calls).toEqual({
        registry: 0,
        health: 0,
        cache: 0,
        selection: 0,
        trace: 0,
        network: 0,
      });
      for (let index = 0; index < report.played.length; index++) {
        expect(report.played[index]).toMatchObject({
          filePath: join(report.dir, `owned-${index + 1}.mp4`),
          subtitle: join(report.dir, `owned-${index + 1}.srt`),
          subtitlePath: join(report.dir, `owned-${index + 1}.srt`),
          providerId: "retired-provider",
          abortSignal: true,
          timing: { intro: { start: 0, end: 10 } },
          generationHook: true,
        });
      }
    });
  }

  for (const scenario of ["missing", "invalid"]) {
    test(`${scenario}: offline failure is visible and never falls back online`, async () => {
      const report = await runScenario(scenario);
      expect(report.played).toEqual([]);
      expect(report.result).toEqual({ status: "success", value: "back_to_results" });
      expect(report.problem.cause).toBe("offline-file-unavailable");
      expect(report.calls.registry).toBe(0);
      expect(report.calls.network).toBe(0);
    });
  }

  test("next downloaded episode retains its saved resume offer after provider retirement", async () => {
    const report = await runScenario("series-resume");
    expect(report.played).toHaveLength(2);
    expect(report.played[1].resumePromptAt).toBe(30);
    expect(report.calls).toEqual({
      registry: 0,
      health: 0,
      cache: 0,
      selection: 0,
      trace: 0,
      network: 0,
    });
  });

  test("local player failure never invalidates or penalizes the retired provider", async () => {
    const report = await runScenario("movie-error");
    expect(report.played).toHaveLength(1);
    expect(report.result).toEqual({ status: "success", value: "back_to_results" });
    expect(report.problem.cause).toBe("local-playback-failed");
    expect(report.calls).toEqual({
      registry: 0,
      health: 0,
      cache: 0,
      selection: 0,
      trace: 0,
      network: 0,
    });
  });

  for (const scenario of ["series-postplay", "anime-postplay"]) {
    test(`${scenario}: Episodes selects a downloaded row without remote metadata`, async () => {
      const report = await runScenario(scenario);
      expect(report.played).toHaveLength(2);
      expect(report.played[1].filePath).toBe(join(report.dir, "owned-2.mp4"));
      expect(report.pickerValues).toHaveLength(2);
      expect(report.calls).toEqual({
        registry: 0,
        health: 0,
        cache: 0,
        selection: 0,
        trace: 0,
        network: 0,
      });
      if (scenario.startsWith("anime")) {
        expect(report.currentEpisode.providerEpisodeIdentity).toEqual({
          providerId: "retired-provider",
          value: "OVA",
        });
      }
    });
  }

  test("local Tracks shows file facts and refuses stale provider picks without changing preferences", async () => {
    const report = await runScenario("movie-postplay-tracks");
    expect(report.panelProviderRows).toBe(0);
    expect(report.played).toHaveLength(1);
    expect(report.provider).toBe("retired-provider");
    expect(report.calls).toEqual({
      registry: 0,
      health: 0,
      cache: 0,
      selection: 0,
      trace: 0,
      network: 0,
    });
  });

  test("online acquisition still requires an available provider", async () => {
    const report = await runScenario("online");
    expect(report.played).toEqual([]);
    expect(report.result).toMatchObject({
      status: "error",
      error: { code: "PROVIDER_UNAVAILABLE" },
    });
  });
});
