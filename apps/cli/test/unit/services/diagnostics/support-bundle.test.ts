import { describe, expect, test } from "bun:test";

import { buildDiagnosticsSupportBundle } from "@/services/diagnostics/support-bundle";

describe("DiagnosticsSupportBundle", () => {
  test("builds layered summary and section metadata", () => {
    const bundle = buildDiagnosticsSupportBundle({
      appVersion: "0.1.0",
      debug: true,
      now: () => new Date("2026-05-16T00:00:00.000Z"),
      events: [
        {
          timestamp: 1,
          category: "provider",
          level: "info",
          operation: "provider.resolve",
          message: "Provider resolve started",
        },
        {
          timestamp: 2,
          category: "network",
          level: "warn",
          operation: "network.snapshot",
          message: "Network unavailable",
        },
      ],
    });

    expect(bundle.summary.headline).toBe("Network unavailable");
    expect(bundle.summary.sections).toEqual(["network", "provider"]);
    expect(bundle.sections.network).toMatchObject({ tone: "warning", eventCount: 1 });
    expect(bundle.sections.provider).toMatchObject({ tone: "neutral", eventCount: 1 });
    expect(bundle.privacy).toEqual({
      redacted: true,
      excludes: ["stream URLs", "subtitle URLs", "headers", "tokens", "local paths"],
    });
  });

  test("summarizes presence and download sections with latest operation details", () => {
    const bundle = buildDiagnosticsSupportBundle({
      appVersion: "0.1.0",
      debug: true,
      now: () => new Date("2026-05-16T00:00:00.000Z"),
      events: [
        {
          timestamp: 1,
          category: "presence",
          level: "warn",
          operation: "presence.clear.failed",
          message: "Presence clear failed",
        },
        {
          timestamp: 2,
          category: "download",
          level: "info",
          operation: "download.artifact.validated",
          message: "Download artifact validated",
        },
      ],
    });

    expect(bundle.summary.sections).toEqual(["presence", "download"]);
    expect(bundle.sections.presence).toMatchObject({
      tone: "warning",
      eventCount: 1,
      latestOperation: "presence.clear.failed",
      latestMessage: "Presence clear failed",
    });
    expect(bundle.sections.download).toMatchObject({
      tone: "neutral",
      latestOperation: "download.artifact.validated",
      latestOperationSummary: "A completed download passed local artifact validation.",
      latestUserAction: "Open /downloads or /library if the artifact later disappears.",
    });
  });

  test("includes playback source inventory summaries without raw media locations", () => {
    const bundle = buildDiagnosticsSupportBundle({
      appVersion: "0.1.0",
      debug: true,
      now: () => new Date("2026-05-16T00:00:00.000Z"),
      playbackSourceInventory: {
        providerId: "rivestream",
        status: "resolved",
        selected: {
          sourceId: "source-b",
          streamId: "stream-b",
          qualityLabel: "720p",
          audioLanguageCount: 1,
          subtitleLanguageCount: 1,
          hasArtwork: true,
          hasSeekBarThumbnails: true,
        },
        sourceGroups: [
          {
            id: "source-b",
            label: "RiveStream",
            state: "selected",
            hints: ["selected", "host cdn.example"],
            nativeLabelCount: 1,
            hasArtwork: true,
            hasSeekBarThumbnails: true,
            audioLanguageCount: 1,
            subtitleLanguageCount: 1,
            candidateCount: 1,
          },
        ],
        languageOptions: [],
        qualityOptions: [
          {
            id: "quality:720p",
            label: "720p",
            state: "selected",
            hints: ["selected"],
            qualityRank: 720,
            candidateCount: 1,
          },
        ],
        subtitleOptions: [
          {
            id: "subtitle:en",
            label: "English",
            state: "selected",
            delivery: "external",
            language: "en",
            candidateCount: 1,
          },
        ],
        recoveryActions: [
          {
            id: "retry-current",
            disabled: false,
            preservesTimestamp: true,
            changesCacheIdentity: false,
          },
        ],
        warnings: [],
        traceSummary: {
          providerId: "rivestream",
          selectedStreamId: "stream-b",
          sourceCount: 1,
          streamCount: 1,
          subtitleCount: 1,
          failureCount: 0,
          eventCount: 2,
          cacheHit: false,
        },
      },
      events: [],
    });

    expect(bundle.playbackSourceInventory?.sourceGroups[0]?.label).toBe("RiveStream");
    expect(bundle.playbackSourceInventory?.qualityOptions[0]?.label).toBe("720p");
    expect(JSON.stringify(bundle.playbackSourceInventory)).not.toContain("private-stream");
  });

  test("summarizes provider cache post-playback and repair diagnostics", () => {
    const bundle = buildDiagnosticsSupportBundle({
      appVersion: "0.1.0",
      debug: true,
      now: () => new Date("2026-05-16T00:00:00.000Z"),
      events: [
        {
          timestamp: 1,
          category: "provider",
          level: "info",
          operation: "provider.resolve.timeline",
          message: "Resolved with fallback",
          context: { attempts: 2, traceId: "trace-1" },
        },
        {
          timestamp: 2,
          category: "cache",
          level: "info",
          operation: "source-inventory.cache.hit",
          message: "Source inventory cache hit",
          context: { keyHash: "abc123" },
        },
        {
          timestamp: 3,
          category: "playback",
          level: "info",
          operation: "post-playback.recommendations.seed",
          message: "Post-playback recommendations seeded for first paint",
          context: { itemCount: 3, elapsedMs: 0 },
        },
        {
          timestamp: 4,
          category: "download",
          level: "warn",
          operation: "download.artifact.repairable",
          message: "Download completed with repairable sidecar",
          context: { artifact: "subtitle", artifactStatus: "expected-missing" },
        },
      ],
    });

    expect(bundle.insights.providerResolve).toMatchObject({
      eventCount: 1,
      latestOperation: "provider.resolve.timeline",
      context: { attempts: 2 },
    });
    expect(bundle.insights.sourceInventoryCache).toMatchObject({
      eventCount: 1,
      latestOperation: "source-inventory.cache.hit",
      context: { keyHash: "abc123" },
    });
    expect(bundle.insights.postPlayback).toMatchObject({
      eventCount: 1,
      latestOperation: "post-playback.recommendations.seed",
      context: { itemCount: 3 },
    });
    expect(bundle.insights.downloadRepair).toMatchObject({
      eventCount: 1,
      latestOperation: "download.artifact.repairable",
      context: { artifact: "subtitle" },
    });
  });

  test("summarizes bounded offline continuity decisions without leaking locations", () => {
    const bundle = buildDiagnosticsSupportBundle({
      appVersion: "0.1.0",
      debug: true,
      events: [
        {
          timestamp: 1,
          category: "download",
          level: "warn",
          operation: "download.capacity.start",
          message: "Download paused before start because free space is reserved",
          context: { titleId: "anilist:1", outputPath: `${process.env.HOME}/secret/show.mkv` },
        },
        {
          timestamp: 2,
          category: "download",
          level: "info",
          operation: "offline-runway.evaluate",
          message: "Offline continuation runway evaluated",
          context: { titleId: "anilist:1", target: 2, enqueued: 1 },
        },
      ],
    });

    expect(bundle.insights.offlineContinuity).toMatchObject({
      eventCount: 2,
      latestOperation: "offline-runway.evaluate",
      context: { target: 2, enqueued: 1 },
    });
    expect(JSON.stringify(bundle)).not.toContain(`${process.env.HOME}/secret`);
  });

  test("exports a redacted resolve work graph from local ledgers", () => {
    const bundle = buildDiagnosticsSupportBundle({
      appVersion: "0.1.0",
      debug: true,
      resolveWorkLedgers: [
        {
          resolveWorkKey: "resolve:abc123",
          mediaIdentityHash: "media456",
          purpose: "playable",
          freshnessPolicy: "trust-fresh",
          initiatingIntent: "prefetch",
          intents: ["prefetch", "playback"],
          initiatingBudgetLane: "near-need",
          joinedBudgetLanes: ["near-need", "user-blocking"],
          cacheDecisions: ["miss", "inventory-hit"],
          providerAttempts: [
            {
              providerId: "vidking",
              attempt: 1,
              maxAttempts: 2,
              outcome: "failure",
              issueClass: "timeout",
            },
            {
              providerId: "rivestream",
              attempt: 2,
              maxAttempts: 2,
              outcome: "success",
            },
          ],
          inventory: {
            hit: true,
            sourceCount: 2,
            streamCount: 3,
            variantCount: 2,
            subtitleCount: 4,
            audioLanguageCount: 1,
            hardSubLanguageCount: 1,
            hasArtwork: true,
            selectedSourceId: "source-safe",
            selectedStreamId: "stream-safe",
          },
          outcome: "resolved",
        },
      ],
      events: [
        {
          timestamp: 1,
          category: "provider",
          level: "info",
          operation: "resolve.work.insight",
          message: "Resolve work graph exported",
          context: {
            url: "https://cdn.example/private/stream.m3u8?token=secret",
            cookie: "session=secret",
          },
        },
      ],
    });

    expect(bundle.insights.resolveWork).toMatchObject({
      workCount: 1,
      totals: {
        providerAttemptCount: 2,
        sourceCount: 2,
        streamCount: 3,
        variantCount: 2,
        subtitleCount: 4,
      },
    });
    expect(bundle.insights.resolveWork?.physicalWork[0]).toMatchObject({
      resolveWorkKey: "resolve:abc123",
      intents: ["prefetch", "playback"],
      joinedBudgetLanes: ["near-need", "user-blocking"],
      cacheProvenance: ["miss", "inventory-hit"],
      requestCounts: { providerAttemptCount: 2 },
      inventory: { hasArtwork: true, selectedSourceId: "source-safe" },
    });
    expect(JSON.stringify(bundle.insights.resolveWork)).not.toContain("cdn.example");
    expect(JSON.stringify(bundle)).not.toContain("token=secret");
    expect(JSON.stringify(bundle)).not.toContain("session=secret");
  });
});
