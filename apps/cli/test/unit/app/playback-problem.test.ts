import { describe, expect, test } from "bun:test";

import {
  buildPlayerFailureProblem,
  buildProviderResolveProblem,
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
