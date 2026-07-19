import { describe, expect, test } from "bun:test";

import { redactBundleText, redactBundleValue } from "@/services/diagnostics/bundle-redaction";
import { buildDiagnosticsSupportBundle } from "@/services/diagnostics/support-bundle";

describe("bundle-redaction", () => {
  test("redacts home paths, URL query/auth, and usernames from a mixed fixture", () => {
    const fixture = [
      "log: opened /home/kitsune/Videos/show.mkv",
      "log: opened /Users/kitsune/Library/Caches/tmp",
      "USER=kitsune HOME=/home/kitsune",
      "fetch https://cdn.streamhost.example/play.m3u8?token=super-secret&sig=abc",
      "auth https://kitsune:pass@api.example/v1/meta?access_token=tok",
      "proc argv includes /home/kitsune/.config/kunai/config.json for kitsune",
    ].join("\n");

    const redacted = redactBundleText(fixture, {
      homeDir: "/home/kitsune",
      username: "kitsune",
    });

    expect(redacted).not.toContain("/home/kitsune");
    expect(redacted).not.toContain("/Users/kitsune");
    expect(redacted).toContain("~/Videos/show.mkv");
    expect(redacted).toContain("~/Library/Caches/tmp");
    expect(redacted).not.toContain("token=super-secret");
    expect(redacted).not.toContain("sig=abc");
    expect(redacted).not.toContain("access_token=tok");
    expect(redacted).not.toContain("kitsune:pass@");
    expect(redacted).not.toMatch(/(^|[^@\w])kitsune([^@\w]|$)/);
    expect(redacted.toLowerCase()).not.toContain("super-secret");
  });

  test("redacts nested values recursively", () => {
    const redacted = redactBundleValue(
      {
        path: "/Users/ada/Movies/clip.mp4",
        url: "https://edge.example/stream.mp4?auth=secret",
        env: "USER=ada SHELL=/bin/zsh",
      },
      { username: "ada", homeDir: "/Users/ada" },
    );

    expect(redacted).toEqual({
      path: "~/Movies/clip.mp4",
      url: expect.stringMatching(/^https:\/\/.*stream\.mp4$/),
      env: expect.stringMatching(/USER=~/),
    });
    expect(JSON.stringify(redacted)).not.toContain("ada");
    expect(JSON.stringify(redacted)).not.toContain("auth=secret");
  });

  test("strips search queries and human titles from nested context keys and sibling messages", () => {
    const QUERY = "find Neon Shadow Chronicles";
    const TITLE = "Neon Shadow Chronicles";
    const redacted = redactBundleValue({
      message: `Searched ${QUERY} for ${TITLE}`,
      context: {
        query: QUERY,
        title: TITLE,
        displayTitle: TITLE,
        providerId: "allanime",
      },
    });

    const serialized = JSON.stringify(redacted);
    expect(serialized).not.toContain(QUERY);
    expect(serialized).not.toContain(TITLE);
    expect(redacted).toMatchObject({
      context: {
        query: "[redacted]",
        title: "[redacted]",
        displayTitle: "[redacted]",
        providerId: "allanime",
      },
    });
  });

  test("redacts bare stream hosts in inventory labels and host hints", () => {
    const HOST = "cdn.leaky-stream.example";
    const redacted = redactBundleValue({
      sourceGroups: [
        {
          id: "source-1",
          label: HOST,
          hints: [`host ${HOST}`, "selected"],
          state: "selected",
        },
      ],
      host: HOST,
    });

    const serialized = JSON.stringify(redacted);
    expect(serialized).not.toContain(HOST);
    expect(serialized).toContain("[redacted-host]");
  });
});

describe("support-bundle privacy acceptance", () => {
  test("serialized bundle never contains seeded query or title strings", () => {
    const QUERY = "unique-query-zx9q";
    const TITLE = "Unique Title Zx9q Never Leak";
    const bundle = buildDiagnosticsSupportBundle({
      appVersion: "0.3.0",
      debug: false,
      redaction: { homeDir: "/home/shadowkit", username: "shadowkit" },
      events: [
        {
          timestamp: 1,
          category: "session",
          level: "info",
          operation: "session.search",
          message: `User searched ${QUERY}`,
          context: { query: QUERY, title: TITLE },
        },
      ],
    });

    const serialized = JSON.stringify(bundle);
    expect(serialized).not.toContain(QUERY);
    expect(serialized).not.toContain(TITLE);
  });

  test("shadow XDG acceptance: username, watched title, and stream host are absent", () => {
    const USER = "shadowkit";
    const TITLE = "Watched Shadow Title Never Export";
    const HOST = "cdn.shadow-stream.example";
    const QUERY = "shadow-search-query-never-export";

    const bundle = buildDiagnosticsSupportBundle({
      appVersion: "0.3.0",
      debug: false,
      redaction: { homeDir: `/home/${USER}`, username: USER },
      environment: {
        mpvVersion: "mpv 0.38.0",
        terminal: "kitty",
        enabledProviders: ["allanime"],
        schemaVersions: { data: ["001"], cache: ["001"] },
        runtimeHealth: { network: "ok" },
      },
      playbackSourceInventory: {
        providerId: "rivestream",
        status: "resolved",
        selected: {
          sourceId: "source-b",
          streamId: "stream-b",
          qualityLabel: "720p",
          audioLanguageCount: 1,
          subtitleLanguageCount: 1,
          hasArtwork: false,
          hasSeekBarThumbnails: false,
        },
        sourceGroups: [
          {
            id: "source-b",
            label: HOST,
            state: "selected",
            hints: [`host ${HOST}`, "selected"],
            nativeLabelCount: 0,
            hasArtwork: false,
            hasSeekBarThumbnails: false,
            audioLanguageCount: 1,
            subtitleLanguageCount: 1,
            candidateCount: 1,
          },
        ],
        languageOptions: [],
        qualityOptions: [],
        subtitleOptions: [],
        recoveryActions: [],
        warnings: [],
        traceSummary: {
          providerId: "rivestream",
          selectedStreamId: "stream-b",
          sourceCount: 1,
          streamCount: 1,
          subtitleCount: 0,
          failureCount: 0,
          eventCount: 1,
          cacheHit: false,
        },
      },
      events: [
        {
          timestamp: 1,
          category: "provider",
          level: "info",
          operation: "provider.resolve",
          message: `Resolved ${TITLE} via https://${HOST}/play.m3u8?token=secret for ${USER}`,
          context: {
            query: QUERY,
            title: TITLE,
            url: `https://${HOST}/play.m3u8?token=secret`,
            outputPath: `/home/${USER}/Videos/${TITLE}.mkv`,
          },
        },
      ],
    });

    // History is never a bundle field — only prove sensitive seeds are absent.
    expect(bundle).not.toHaveProperty("history");
    expect(bundle).not.toHaveProperty("watchHistory");

    const serialized = JSON.stringify(bundle);
    expect(serialized).not.toContain(USER);
    expect(serialized).not.toContain(TITLE);
    expect(serialized).not.toContain(HOST);
    expect(serialized).not.toContain(QUERY);
    expect(serialized).not.toContain("token=secret");
    expect(serialized).not.toContain(`/home/${USER}`);
  });
});
