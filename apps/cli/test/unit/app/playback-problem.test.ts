import { describe, expect, test } from "bun:test";

import {
  buildMpvMissingProblem,
  buildOfflineFileUnavailableProblem,
  buildPlayerFailureProblem,
  buildProviderResolveProblem,
  toErrorScenario,
} from "@/domain/playback/playback-problem";

describe("playback problem model", () => {
  test("maps an unplayable downloaded file to a blocking problem that names the remedy", () => {
    const problem = buildOfflineFileUnavailableProblem();

    expect(problem).toMatchObject({
      stage: "stream-open",
      severity: "blocking",
      cause: "offline-file-unavailable",
      recommendedAction: "diagnostics",
      secondaryActions: ["refresh"],
    });
    // The user reached this by launching a title the library still advertises as
    // downloaded, so the copy has to say what to do rather than only what broke.
    expect(problem.userMessage).toContain("integrity check");
  });

  test("renders an unplayable download through the error surface, not a raw slug", () => {
    // Without a case in `toErrorScenario` this fell through to undefined, and
    // the shell showed the bare cause slug "offline-file-unavailable" instead of
    // the error screen every other blocking failure gets.
    expect(toErrorScenario(buildOfflineFileUnavailableProblem(), { title: "Obsession" })).toEqual({
      kind: "title-unavailable",
      title: "Obsession",
    });
  });

  test("maps missing mpv to a blocking playback dependency problem", () => {
    const problem = buildMpvMissingProblem({
      remediationSummary: "Install mpv to enable playback.",
      commands: ["sudo apt install mpv"],
    });

    expect(problem).toMatchObject({
      stage: "mpv",
      severity: "blocking",
      cause: "mpv-missing",
      recommendedAction: "settings",
    });
    expect(problem.userMessage).toContain("apt install mpv");
    expect(toErrorScenario(problem)).toBeUndefined();
  });

  test("maps runtime dependency failures to blocking diagnostics", () => {
    const problem = buildProviderResolveProblem({
      attempts: [{ failure: { code: "RUNTIME_MISSING", message: "runtime dependency missing" } }],
      capabilitySnapshot: null,
    });

    expect(problem.cause).toBe("runtime-missing");
    expect(problem.severity).toBe("blocking");
    expect(problem.recommendedAction).toBe("diagnostics");
  });

  test("maps missing yt-dlp to an actionable YouTube setup problem", () => {
    const problem = buildProviderResolveProblem({
      attempts: [
        {
          failure: {
            code: "yt-dlp-missing",
            message: "yt-dlp is required for YouTube playback. Install yt-dlp and retry.",
          },
        },
      ],
      capabilitySnapshot: null,
    });

    expect(problem).toMatchObject({
      cause: "yt-dlp-missing",
      severity: "blocking",
      recommendedAction: "settings",
      secondaryActions: ["diagnostics"],
    });
    expect(problem.userMessage).toContain("Install yt-dlp");
    expect(toErrorScenario(problem)).toBeUndefined();
  });

  test("maps player exit to relaunch before provider fallback", () => {
    const problem = buildPlayerFailureProblem("player-exited");

    expect(problem.stage).toBe("mpv");
    expect(problem.recommendedAction).toBe("relaunch");
    expect(problem.secondaryActions).toContain("try-next-provider");
  });

  test("toErrorScenario maps provider timeout and network failures", () => {
    expect(
      toErrorScenario(
        buildProviderResolveProblem({
          attempts: [{ failure: { message: "timed out waiting for vidking" } }],
        }),
      ),
    ).toEqual({
      kind: "provider-timeout",
      providerName: "provider",
      elapsedSec: 30,
    });

    expect(
      toErrorScenario(
        buildProviderResolveProblem({
          attempts: [{ failure: { message: "timed out waiting for vidking" } }],
        }),
        { providerName: "vidking" },
      ),
    ).toEqual({
      kind: "provider-timeout",
      providerName: "vidking",
      elapsedSec: 30,
    });

    expect(
      toErrorScenario(
        buildProviderResolveProblem({
          attempts: [{ failure: { message: "ERR_INTERNET_DISCONNECTED" } }],
        }),
      ),
    ).toEqual({ kind: "network-offline" });

    expect(
      toErrorScenario(
        buildProviderResolveProblem({
          attempts: [{ failure: { message: "403 forbidden for Severance" } }],
        }),
      ),
    ).toEqual({ kind: "title-unavailable", title: "This title" });

    expect(
      toErrorScenario(
        buildProviderResolveProblem({
          attempts: [
            {
              failure: {
                message: "Videasy requires a valid browser session: session_missing",
              },
            },
          ],
        }),
        { providerName: "VidKing" },
      ),
    ).toEqual({
      kind: "provider-session",
      providerName: "VidKing",
    });

    expect(toErrorScenario(buildPlayerFailureProblem("expired-stream"))).toEqual({
      kind: "stream-broken",
      attempt: 1,
      maxAttempts: 3,
    });
  });

  test("maps missing stream candidates to a blocking no-stream problem", () => {
    const problem = buildProviderResolveProblem({
      attempts: [{ failure: { message: "Direct provider returned no stream candidates" } }],
    });

    expect(problem).toMatchObject({
      cause: "no-stream",
      severity: "blocking",
      userMessage: "No playable stream was found for this episode.",
    });
  });

  test("maps offline provider resolution to a blocking offline problem", () => {
    const problem = buildProviderResolveProblem({
      attempts: [{ failure: { message: "getaddrinfo ENOTFOUND api.example.test" } }],
    });

    expect(problem).toMatchObject({
      cause: "network-offline",
      severity: "blocking",
      recommendedAction: "diagnostics",
      secondaryActions: ["refresh"],
    });
    expect(toErrorScenario(problem)).toEqual({ kind: "network-offline" });
  });
});
