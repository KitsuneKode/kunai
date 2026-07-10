import { describe, expect, test } from "bun:test";

import {
  buildPlayerFailureProblem,
  buildProviderResolveProblem,
  errorShellOffersRetry,
  toErrorScenario,
} from "@/domain/playback/playback-problem";

describe("playback problem model", () => {
  test("maps runtime dependency failures to blocking diagnostics", () => {
    const problem = buildProviderResolveProblem({
      attempts: [{ failure: { code: "RUNTIME_MISSING", message: "runtime dependency missing" } }],
      capabilitySnapshot: null,
    });

    expect(problem.cause).toBe("runtime-missing");
    expect(problem.severity).toBe("blocking");
    expect(problem.recommendedAction).toBe("diagnostics");
    expect(errorShellOffersRetry(problem)).toBe(false);
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
    expect(errorShellOffersRetry(problem)).toBe(false);
  });

  test("maps player exit to relaunch before provider fallback", () => {
    const problem = buildPlayerFailureProblem("player-exited");

    expect(problem.stage).toBe("mpv");
    expect(problem.recommendedAction).toBe("relaunch");
    expect(problem.secondaryActions).toContain("try-next-provider");
    expect(errorShellOffersRetry(problem)).toBe(true);
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

  test("toErrorScenario maps provider-empty / timeout / user-cancel scenarios", () => {
    const emptyByMessage = buildProviderResolveProblem({
      attempts: [{ failure: { message: "Direct provider returned no stream candidates" } }],
    });
    expect(
      toErrorScenario(emptyByMessage, { title: "Severance", providerName: "VidKing" }),
    ).toEqual({
      kind: "provider-empty",
      title: "Severance",
      providerName: "VidKing",
    });
    expect(errorShellOffersRetry(emptyByMessage)).toBe(true);

    const emptyByCode = buildProviderResolveProblem({
      attempts: [{ failure: { code: "not-found", message: "episode missing on source" } }],
    });
    expect(emptyByCode.cause).toBe("no-stream");
    expect(toErrorScenario(emptyByCode, { title: "Dune" })).toEqual({
      kind: "provider-empty",
      title: "Dune",
    });

    const timeout = buildProviderResolveProblem({
      attempts: [{ failure: { code: "timeout", message: "provider timed out after 30s" } }],
    });
    expect(timeout.cause).toBe("provider-timeout");
    expect(toErrorScenario(timeout, { providerName: "Miruro" })).toEqual({
      kind: "provider-timeout",
      providerName: "Miruro",
      elapsedSec: 30,
    });
    expect(errorShellOffersRetry(timeout)).toBe(true);

    const cancelled = buildProviderResolveProblem({
      attempts: [
        { failure: { code: "cancelled", message: "Resolution was cancelled by the user" } },
      ],
    });
    expect(cancelled).toMatchObject({
      cause: "user-cancelled",
      severity: "info",
      userMessage: "Playback resolution was cancelled.",
    });
    expect(toErrorScenario(cancelled)).toEqual({ kind: "user-cancelled" });
    expect(errorShellOffersRetry(cancelled)).toBe(false);
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
    expect(errorShellOffersRetry(problem)).toBe(true);
  });
});
