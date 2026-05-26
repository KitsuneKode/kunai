import { describe, expect, test } from "bun:test";

import {
  buildResolveWorkKey,
  createResolveWorkLedger,
  finalizeResolveWorkLedger,
  recordCacheDecision,
  recordInventoryFacts,
  recordLedgerJoin,
  recordProviderInventoryFacts,
  recordProviderAttempt,
  resolveWorkPurposeForIntent,
} from "@/services/playback/ResolveWorkLedger";

const identity = {
  title: { id: "secret-title-id", type: "series" as const, name: "Test Series" },
  episode: { season: 1, episode: 2 },
  mode: "series" as const,
  providerId: "vidking",
  audioPreference: "original",
  subtitlePreference: "en",
  qualityPreference: "1080p",
  purpose: "playable" as const,
  freshnessPolicy: "trust-fresh" as const,
};

describe("ResolveWorkLedger", () => {
  test("normalizes exact playback and prefetch into one playable work identity", () => {
    expect(resolveWorkPurposeForIntent("playback")).toBe("playable");
    expect(resolveWorkPurposeForIntent("prefetch")).toBe("playable");
    expect(buildResolveWorkKey(identity)).toBe(buildResolveWorkKey({ ...identity }));
    expect(buildResolveWorkKey(identity)).not.toBe(
      buildResolveWorkKey({ ...identity, freshnessPolicy: "force-fresh" }),
    );
  });

  test("separates startup priority in work identity", () => {
    expect(buildResolveWorkKey({ ...identity, startupPriority: "fast" })).not.toBe(
      buildResolveWorkKey({ ...identity, startupPriority: "quality-first" }),
    );
  });

  test("records joined lane and intent separately from work identity", () => {
    const ledger = createResolveWorkLedger({
      identity,
      intent: "prefetch",
      budgetLane: "near-need",
    });
    recordLedgerJoin(ledger, { intent: "playback", budgetLane: "user-blocking" });
    recordCacheDecision(ledger, "inventory-hit");
    recordProviderAttempt(ledger, { providerId: "vidking", attempt: 1, maxAttempts: 2 });
    recordProviderAttempt(ledger, {
      providerId: "vidking",
      attempt: 1,
      maxAttempts: 2,
      outcome: "failure",
      issueClass: "timeout",
    });
    recordInventoryFacts(ledger, { sourceCount: 2, streamCount: 3, subtitleCount: 1 });

    const snapshot = finalizeResolveWorkLedger(ledger, "resolved");

    expect(snapshot.initiatingIntent).toBe("prefetch");
    expect(snapshot.intents).toEqual(["prefetch", "playback"]);
    expect(snapshot.joinedBudgetLanes).toEqual(["near-need", "user-blocking"]);
    expect(snapshot.inventory).toEqual({
      hit: true,
      sourceCount: 2,
      streamCount: 3,
      subtitleCount: 1,
    });
    expect(snapshot.providerAttempts).toHaveLength(1);
    expect(snapshot.providerAttempts[0]?.issueClass).toBe("timeout");
  });

  test("keeps raw title identifiers and stream evidence out of serialized ledgers", () => {
    const ledger = createResolveWorkLedger({
      identity,
      intent: "playback",
      budgetLane: "user-blocking",
    });

    const serialized = JSON.stringify(finalizeResolveWorkLedger(ledger));

    expect(serialized).not.toContain("secret-title-id");
    expect(serialized).not.toContain("https://");
  });

  test("records rich provider facts already present on the resolved payload", () => {
    const ledger = createResolveWorkLedger({
      identity,
      intent: "playback",
      budgetLane: "user-blocking",
    });

    recordProviderInventoryFacts(ledger, {
      selectedStreamId: "stream-main",
      streams: [
        {
          id: "stream-main",
          providerId: "miruro",
          url: "https://private.example/stream.m3u8",
          sourceId: "source-kiwi",
          serverName: "Kiwi",
          protocol: "hls",
          qualityLabel: "1080p",
          audioLanguages: ["ja"],
          hardSubLanguage: "en",
          artwork: { seekBarVttUrl: "https://private.example/thumbs.vtt" },
          confidence: 0.9,
          cachePolicy: {
            ttlClass: "stream-manifest",
            scope: "local",
            keyParts: ["provider", "miruro", "stream-main"],
          },
          metadata: { intro: { start: 90, end: 180 } },
        },
      ],
      sources: [
        {
          id: "source-kiwi",
          providerId: "miruro",
          kind: "manifest",
          label: "Kiwi",
          status: "selected",
          confidence: 0.9,
        },
      ],
      variants: [
        {
          id: "variant-main",
          providerId: "miruro",
          sourceId: "source-kiwi",
          label: "Sub 1080p",
          streamIds: ["stream-main"],
          confidence: 0.9,
        },
      ],
      subtitles: [
        {
          id: "subtitle-en",
          providerId: "miruro",
          url: "https://private.example/sub.vtt",
          language: "en",
          source: "provider",
          confidence: 0.9,
          cachePolicy: {
            ttlClass: "subtitle-list",
            scope: "local",
            keyParts: ["provider", "miruro", "subtitle-en"],
          },
        },
      ],
      artwork: { seekBarVttUrl: "https://private.example/thumbs.vtt" },
      externalIds: { anilistId: "151807", malId: "52299" },
    });

    const snapshot = finalizeResolveWorkLedger(ledger, "resolved");

    expect(snapshot.inventory).toMatchObject({
      sourceCount: 1,
      streamCount: 1,
      variantCount: 1,
      subtitleCount: 1,
      audioLanguageCount: 1,
      hardSubLanguageCount: 1,
      hasArtwork: true,
      hasTimingHints: true,
      externalIdCount: 2,
      selectedSourceId: "source-kiwi",
      selectedStreamId: "stream-main",
    });
    expect(JSON.stringify(snapshot)).not.toContain("private.example");
  });
});
