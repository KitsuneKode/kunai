import { describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  classify,
  composeStatusNote,
  PROBES,
  runProviderStatusSweep,
  summarizeProbeResolution,
} from "../scripts/provider-status-sweep";
import { configureYoutubeProvider, getYoutubeProviderConfig } from "../src/youtube/direct";
import { createYoutubeMetadataService } from "../src/youtube/youtube-metadata-service";

/**
 * The daily sweep commits statuses straight to the docs site — a misread here
 * publishes a confidently wrong board with no human in the loop. Pin the
 * decision table deterministically (upstreamHttp × resolveStatus × streams ×
 * firstFailureCode) since the live probe can never exercise the unhappy rows.
 */
describe("provider-status-sweep classify", () => {
  test("resolved with streams is healthy", () => {
    expect(classify(200, "resolved", 3, undefined)).toEqual({
      status: "healthy",
      note: "",
    });
  });

  test("unreachable upstream without resolution is dead", () => {
    expect(classify(null, "exhausted", 0, "network-error").status).toBe("dead");
    expect(classify(null, "error", 0, "timeout").status).toBe("dead");
  });

  test("unreachable upstream that still resolved stays healthy", () => {
    // The front-door probe is a hint, not a gate — a probe that timed out while
    // resolve succeeded should never publish "dead".
    expect(classify(null, "resolved", 2, undefined).status).toBe("healthy");
  });

  test("blocked failure code describes the refusal observed by the runner", () => {
    expect(classify(403, "exhausted", 0, "blocked")).toEqual({
      status: "blocked",
      note: "upstream denied access from the sweep runner",
    });
  });

  test("a resolver refusal takes precedence over an unanswered front-door HEAD", () => {
    expect(classify(null, "exhausted", 0, "blocked").status).toBe("blocked");
  });

  test("upstream 503 reports maintenance", () => {
    expect(classify(503, "exhausted", 0, "provider-unavailable").status).toBe("down");
  });

  test("resolved with zero streams is degraded, not healthy", () => {
    expect(classify(200, "resolved", 0, undefined).status).toBe("degraded");
  });

  test("exhausted with reachable upstream is degraded", () => {
    expect(classify(200, "exhausted", 0, "not-found").status).toBe("degraded");
  });

  test("a classified note keeps the provider's own failure text", () => {
    expect(
      composeStatusNote(
        "upstream up but resolve exhausted",
        "Videasy wings-hdmovie did not produce a playable source",
      ),
    ).toBe(
      "upstream up but resolve exhausted — Videasy wings-hdmovie did not produce a playable source",
    );
  });

  test("an empty class note is the failure text", () => {
    expect(composeStatusNote("", "yt-dlp is required")).toBe("yt-dlp is required");
  });

  test("published notes redact URLs and loose query strings before truncation", () => {
    const note = composeStatusNote(
      "refused https://cdn.example/path?sig=SENTINEL",
      'upstream error at /media?sig=SENTINEL and //cdn.example/path?sig=SENTINEL or sig="SENTINEL with spaces"',
    );
    expect(note).not.toContain("SENTINEL");
    expect(note).not.toContain("cdn.example");
    expect(note).toContain("upstream error");
  });

  test("extractor stderr and thrown provider errors stay out of the artifact and logs", async () => {
    const youtube = PROBES.find(({ id }) => id === "youtube");
    if (!youtube) throw new Error("Missing YouTube status probe");
    const dir = await mkdtemp(join(tmpdir(), "provider-status-"));
    const outputPath = join(dir, "status.json");
    const stderr = "ERROR: unexpected extractor reply at https://cdn.example/watch?sig=SENTINEL";
    const logs: string[] = [];
    const log = spyOn(console, "log").mockImplementation((line: string) => {
      logs.push(line);
    });
    const originalWhich = Bun.which;
    const which = spyOn(Bun, "which").mockImplementation((name, options) =>
      name === "yt-dlp" ? process.execPath : originalWhich(name, options),
    );
    const originalConfig = getYoutubeProviderConfig();
    configureYoutubeProvider({
      metadataService: createYoutubeMetadataService({
        extractOptions: {
          spawn: () => {
            const proc = Bun.spawn(
              [
                process.execPath,
                "-e",
                "console.error(process.argv[1]); process.exitCode = 1;",
                stderr,
              ],
              { stdout: "pipe", stderr: "pipe" },
            );
            return {
              stdout: proc.stdout,
              stderr: proc.stderr,
              exited: proc.exited,
              kill: () => proc.kill(),
            };
          },
        },
      }),
    });

    try {
      const frontDoor = "data:text/plain,ok";
      await runProviderStatusSweep(
        [
          { ...youtube, frontDoor },
          {
            ...youtube,
            id: "throws",
            frontDoor,
            module: {
              resolve: async () => {
                throw new Error("redirect to /media?sig=SENTINEL");
              },
            },
          },
        ],
        outputPath,
      );
      const artifact = await Bun.file(outputPath).text();
      const output = logs.join("\n");
      expect(artifact).not.toContain("SENTINEL");
      expect(output).not.toContain("SENTINEL");
      expect(artifact).toContain('"failureCode": "parse-failed"');
      expect(output).toContain("failure=parse-failed");
      expect(output).toContain("yt-dlp metadata failed");
      expect(output).toContain("redirect to /media[redacted query]");
    } finally {
      configureYoutubeProvider(originalConfig);
      which.mockRestore();
      log.mockRestore();
      await rm(dir, { recursive: true, force: true });
    }
  });

  test.each([
    [11_999, true, "healthy", "qualified for default playback"],
    [12_000, false, "degraded", "resolved within sweep"],
    [21_917, false, "degraded", "resolved within sweep"],
  ])(
    "a stream resolved in %d ms reports default playback qualification",
    (ms, qualified, status, label) => {
      const row = summarizeProbeResolution(
        "animegg",
        200,
        { status: "resolved", streams: [{ metadata: {} }], failures: [] },
        ms,
      );
      expect(row).toMatchObject({ status, qualifiedForDefaultPlayback: qualified });
      expect(row.note).toContain(label);
    },
  );

  test("YouTube health requires a video format discovered by yt-dlp", () => {
    const watchUrlFallback = { metadata: { metadataUnavailable: true } };
    const fallback = summarizeProbeResolution(
      "youtube",
      200,
      {
        status: "resolved",
        streams: [watchUrlFallback],
        failures: [],
      },
      1000,
    );
    expect(fallback).toMatchObject({
      status: "degraded",
      note: "yt-dlp did not discover video formats",
      streams: [],
      qualifiedForDefaultPlayback: false,
    });

    const format = { metadata: { formatId: "137" } };
    const extracted = summarizeProbeResolution(
      "youtube",
      200,
      {
        status: "resolved",
        streams: [watchUrlFallback, format],
        failures: [],
      },
      1000,
    );
    expect(extracted).toMatchObject({
      status: "healthy",
      qualifiedForDefaultPlayback: true,
      streams: [format],
    });
  });

  test("unclassified resolve status falls through to degraded with the status in the note", () => {
    const row = classify(200, "cancelled", 0, undefined);
    expect(row.status).toBe("degraded");
    expect(row.note).toContain("cancelled");
  });
});
